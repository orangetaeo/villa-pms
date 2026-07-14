// POST /api/villas/[id]/rate-periods/batch — 일괄 작업 (rate-calendar-ux)
// action 3종을 하나의 batchId로 묶어 생성($transaction). 그룹 단위 취소는 DELETE .../batch/[batchId].
//   · ADJUST     : 각 range의 밤을 "현재 승자 행" 기준 구간화(segmentByWinner) → 구간별 조정 레이어
//                  (가격 = 승자값 × (1+pct/100), VND 1,000동·KRW 100원 반올림; premium 컬럼은 원본 non-null만).
//   · SET        : range당 레이어 1개(고정가 입력).
//   · COPY_YEAR  : 선택 레이어를 연도 시프트(같은 월·일, 2/29→2/28)해 복사, pct 있으면 전 컬럼 조정.
// base(isBase) 생성 금지 — 모든 신규 행 isBase=false. 권한 ADMIN(canSetPrice). writeAuditLog 필수.
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canSetPrice } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import {
  SEASONS,
  isoDate,
  toUtc,
  priceColumns,
  buildPriceColumnData,
  RATE_PERIOD_FULL_SELECT,
} from "@/lib/rate-period-input";
import {
  segmentByWinner,
  shiftDateYears,
  generateBatchId,
  adjustVnd,
  adjustKrw,
  type DateRange,
} from "@/lib/rate-layers";

type FullRow = Prisma.VillaRatePeriodGetPayload<{ select: typeof RATE_PERIOD_FULL_SELECT }>;
type CreateRow = Prisma.VillaRatePeriodCreateManyInput;

const rangeSchema = z.object({ start: isoDate, end: isoDate });
const ranges = z.array(rangeSchema).min(1).max(120);
const pct = z.number().finite();
const targets = z.object({
  net: z.boolean().optional(),
  consumer: z.boolean().optional(),
  cost: z.boolean().optional(),
});

const adjustBody = z.object({ action: z.literal("ADJUST"), ranges, pct, targets });
const setBody = z.object({
  action: z.literal("SET"),
  ranges,
  season: z.enum(SEASONS),
  label: z.string().trim().max(60).nullable().optional(),
  prices: z.object(priceColumns),
});
const copyBody = z.object({
  action: z.literal("COPY_YEAR"),
  srcYear: z.number().int().min(2020).max(2100),
  dstYear: z.number().int().min(2020).max(2100),
  layerIds: z.array(z.string()).min(1).max(120),
  pct: pct.optional(),
});
const batchSchema = z.discriminatedUnion("action", [adjustBody, setBody, copyBody]);

/** half-open range 유효성(start<end) — 잘못된 range 있으면 첫 인덱스 반환, 없으면 -1. */
function firstBadRange(list: { start: string; end: string }[]): number {
  return list.findIndex((r) => toUtc(r.start).getTime() >= toUtc(r.end).getTime());
}

const pctTag = (p: number) => `${p > 0 ? "+" : ""}${p}%`;
const clip = (s: string) => s.slice(0, 60);

/** ADJUST — 승자 행 클론 + 대상 축 pct 조정. 비대상 축·마진·공급자가는 원본 유지. premium은 non-null만 조정. */
function adjustLayerData(
  villaId: string,
  seg: { start: Date; end: Date; row: FullRow },
  p: number,
  tg: { net?: boolean; consumer?: boolean; cost?: boolean },
  batchId: string
): CreateRow {
  const cost = !!tg.cost;
  const net = !!tg.net;
  const consumer = !!tg.consumer;
  const vnd = (v: bigint | null, on: boolean) => (v == null ? v : on ? adjustVnd(v, p) : v);
  const krw = (v: number | null, on: boolean) => (v == null ? v : on ? adjustKrw(v, p) : v);
  const r = seg.row;
  return {
    villaId,
    season: r.season,
    isBase: false,
    startDate: seg.start,
    endDate: seg.end,
    label: clip(`일괄 ${pctTag(p)} · ${r.isBase ? "기본요금" : r.label ?? "기간"}`),
    batchId,
    supplierCostVnd: vnd(r.supplierCostVnd, cost)!,
    marginType: r.marginType,
    marginValue: r.marginValue,
    salePriceVnd: vnd(r.salePriceVnd, net)!,
    salePriceKrw: krw(r.salePriceKrw, net)!,
    consumerMarginType: r.consumerMarginType,
    consumerMarginValue: r.consumerMarginValue,
    consumerSalePriceVnd: vnd(r.consumerSalePriceVnd, consumer),
    consumerSalePriceKrw: krw(r.consumerSalePriceKrw, consumer),
    supplierSalePriceVnd: r.supplierSalePriceVnd, // 비대상 축 — 원본 유지
    premiumSupplierCostVnd: vnd(r.premiumSupplierCostVnd, cost),
    premiumSalePriceVnd: vnd(r.premiumSalePriceVnd, net),
    premiumSalePriceKrw: krw(r.premiumSalePriceKrw, net),
    premiumConsumerSalePriceVnd: vnd(r.premiumConsumerSalePriceVnd, consumer),
    premiumConsumerSalePriceKrw: krw(r.premiumConsumerSalePriceKrw, consumer),
    premiumSupplierSalePriceVnd: r.premiumSupplierSalePriceVnd, // 유지
  };
}

/** COPY_YEAR — 원본 레이어를 연도 시프트해 클론. pct(≠0) 있으면 전 가격 컬럼(non-null) 조정. */
function copyLayerData(
  villaId: string,
  row: FullRow,
  deltaYears: number,
  p: number,
  batchId: string
): CreateRow {
  const on = p !== 0;
  const vnd = (v: bigint | null) => (v == null ? v : on ? adjustVnd(v, p) : v);
  const krw = (v: number | null) => (v == null ? v : on ? adjustKrw(v, p) : v);
  return {
    villaId,
    season: row.season,
    isBase: false,
    startDate: shiftDateYears(row.startDate!, deltaYears),
    endDate: shiftDateYears(row.endDate!, deltaYears),
    label: row.label,
    batchId,
    supplierCostVnd: vnd(row.supplierCostVnd)!,
    marginType: row.marginType,
    marginValue: row.marginValue,
    salePriceVnd: vnd(row.salePriceVnd)!,
    salePriceKrw: krw(row.salePriceKrw)!,
    consumerMarginType: row.consumerMarginType,
    consumerMarginValue: row.consumerMarginValue,
    consumerSalePriceVnd: vnd(row.consumerSalePriceVnd),
    consumerSalePriceKrw: krw(row.consumerSalePriceKrw),
    supplierSalePriceVnd: vnd(row.supplierSalePriceVnd),
    premiumSupplierCostVnd: vnd(row.premiumSupplierCostVnd),
    premiumSalePriceVnd: vnd(row.premiumSalePriceVnd),
    premiumSalePriceKrw: krw(row.premiumSalePriceKrw),
    premiumConsumerSalePriceVnd: vnd(row.premiumConsumerSalePriceVnd),
    premiumConsumerSalePriceKrw: krw(row.premiumConsumerSalePriceKrw),
    premiumSupplierSalePriceVnd: vnd(row.premiumSupplierSalePriceVnd),
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const actorUserId = g.session.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // range 유효성(ADJUST·SET 공통) — half-open start<end
  if (data.action === "ADJUST" || data.action === "SET") {
    const bad = firstBadRange(data.ranges);
    if (bad >= 0) {
      return NextResponse.json({ error: "INVALID_RANGE", index: bad }, { status: 400 });
    }
  }
  if (data.action === "ADJUST" && !(data.targets.net || data.targets.consumer || data.targets.cost)) {
    return NextResponse.json({ error: "NO_TARGET" }, { status: 400 });
  }
  if (data.action === "COPY_YEAR" && data.srcYear === data.dstYear) {
    return NextResponse.json({ error: "SAME_YEAR" }, { status: 400 });
  }

  const batchId = generateBatchId();

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({ where: { id }, select: { id: true } });
    if (!villa) return { kind: "NOT_FOUND" as const };

    const rows: CreateRow[] = [];

    if (data.action === "ADJUST") {
      // 승자 판정에 필요한 base + 전 non-base 행(교차 여부 무관 — 밤별 커버 판정) 로드
      const [base, periods] = await Promise.all([
        tx.villaRatePeriod.findFirst({
          where: { villaId: id, isBase: true },
          select: RATE_PERIOD_FULL_SELECT,
        }),
        tx.villaRatePeriod.findMany({
          where: { villaId: id, isBase: false },
          select: RATE_PERIOD_FULL_SELECT,
        }),
      ]);
      if (!base) return { kind: "BASE_REQUIRED" as const };
      for (const r of data.ranges) {
        const range: DateRange = { start: toUtc(r.start), end: toUtc(r.end) };
        const segs = segmentByWinner<FullRow>(range, periods, base);
        for (const seg of segs) {
          rows.push(adjustLayerData(id, seg, data.pct, data.targets, batchId));
        }
      }
    } else if (data.action === "SET") {
      const priceData = buildPriceColumnData(data.prices);
      for (const r of data.ranges) {
        rows.push({
          villaId: id,
          season: data.season,
          isBase: false,
          startDate: toUtc(r.start),
          endDate: toUtc(r.end),
          label: data.label ?? null,
          batchId,
          ...priceData,
        });
      }
    } else {
      // COPY_YEAR
      const deltaYears = data.dstYear - data.srcYear;
      const sources = await tx.villaRatePeriod.findMany({
        where: { villaId: id, isBase: false, id: { in: data.layerIds } },
        select: RATE_PERIOD_FULL_SELECT,
      });
      const p = data.pct ?? 0;
      for (const row of sources) {
        rows.push(copyLayerData(id, row, deltaYears, p, batchId));
      }
    }

    if (rows.length > 0) {
      await tx.villaRatePeriod.createMany({ data: rows });
    }

    await writeAuditLog({
      db: tx,
      userId: actorUserId,
      action: "CREATE",
      entity: "VillaRatePeriod",
      entityId: id,
      changes: { batch: { new: { action: data.action, batchId, created: rows.length } } },
    });
    return { kind: "OK" as const, created: rows.length };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "BASE_REQUIRED") {
    return NextResponse.json({ error: "BASE_REQUIRED" }, { status: 400 });
  }
  return NextResponse.json({ batchId, created: result.created });
}
