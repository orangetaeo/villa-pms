// PATCH /api/villas/[id]/rate-periods — ADMIN 기간별 요금 전체 교체 (ADR-0014 구현 2/3)
// 모델 VillaRatePeriod: 기본요금(isBase) 1행 + 웃돈 기간 N행. dual-read — 이 빌라가 1행이라도
// 보유하면 lib/pricing.ts가 기간별 경로로 견적(구 VillaRate/SeasonPeriod 무시).
// 입력 주체: 테오팀(ADMIN 전용·canSetPrice). 한 폼에서 기간·원가·판매가 전부 입력(직접수집).
//   ⚠ 공급자 자가 다기간 원가 입력은 후속(현재 공급자는 구 경로 cost 편집기 유지).
// 검증: base 필수·정확히1, 기간 날짜 half-open(start<end)·겹침 거부, season enum, BigInt는 문자열 수신.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canSetPrice } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

const digits = z.string().regex(/^\d{1,15}$/); // VND 동·퍼센트 — BigInt 문자열 수신
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD (UTC 자정 변환)
const SEASONS = ["LOW", "HIGH", "PEAK"] as const;

const priceFields = {
  season: z.enum(SEASONS),
  supplierCostVnd: digits,
  marginType: z.enum(["PERCENT", "FIXED_VND"]),
  marginValue: digits,
  salePriceVnd: digits,
  salePriceKrw: z.number().int().min(0),
  // ADR-0031 소비자 직판가 — Net 대비. VND/KRW는 null 허용(Net 폴백). 마진 미전송 시 기본(0=Net과 동일).
  consumerMarginType: z.enum(["PERCENT", "FIXED_VND"]).default("PERCENT"),
  consumerMarginValue: digits.default("0"),
  consumerSalePriceVnd: digits.nullable().optional(),
  consumerSalePriceKrw: z.number().int().min(0).nullable().optional(),
  label: z.string().trim().max(60).nullable().optional(),
};

const baseSchema = z.object(priceFields); // isBase=true — 날짜 없음
const periodSchema = z.object({ ...priceFields, startDate: isoDate, endDate: isoDate });

const toUtc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const patchSchema = z
  .object({
    base: baseSchema, // 기본요금 필수 (없으면 기간 밖 날짜 견적 불가 — ADR-0014 D5)
    periods: z.array(periodSchema).max(60),
  })
  .superRefine((data, ctx) => {
    // 각 기간: start < end (half-open)
    const valid = data.periods.filter((p, i) => {
      if (toUtc(p.startDate).getTime() >= toUtc(p.endDate).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["periods", i, "endDate"],
          message: "endDate must be after startDate",
        });
        return false;
      }
      return true;
    });
    // 겹침 거부 — 시즌 무관, 날짜만(half-open). 정렬 후 인접 비교 (ADR-0014 D3)
    const sorted = [...valid].sort((a, b) => toUtc(a.startDate).getTime() - toUtc(b.startDate).getTime());
    for (let i = 1; i < sorted.length; i++) {
      if (toUtc(sorted[i].startDate).getTime() < toUtc(sorted[i - 1].endDate).getTime()) {
        const idx = data.periods.indexOf(sorted[i]);
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["periods", idx, "startDate"],
          message: "기간이 다른 기간과 겹칩니다",
        });
      }
    }
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 — ADMIN 전용(canSetPrice). 마진·판매가를 다루므로 STAFF 차단.
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const actorUserId = session.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { base, periods } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({ where: { id }, select: { id: true } });
    if (!villa) return { kind: "NOT_FOUND" as const };

    // 전체 교체 — 기본요금 1행 + 기간 N행 (deleteMany → createMany)
    await tx.villaRatePeriod.deleteMany({ where: { villaId: id } });
    await tx.villaRatePeriod.create({
      data: {
        villaId: id,
        season: base.season,
        isBase: true,
        startDate: null,
        endDate: null,
        label: base.label ?? null,
        supplierCostVnd: BigInt(base.supplierCostVnd),
        marginType: base.marginType,
        marginValue: BigInt(base.marginValue),
        salePriceVnd: BigInt(base.salePriceVnd),
        salePriceKrw: base.salePriceKrw,
        // ADR-0031 — 소비자 직판가(null=Net 폴백)
        consumerMarginType: base.consumerMarginType,
        consumerMarginValue: BigInt(base.consumerMarginValue),
        consumerSalePriceVnd: base.consumerSalePriceVnd != null ? BigInt(base.consumerSalePriceVnd) : null,
        consumerSalePriceKrw: base.consumerSalePriceKrw ?? null,
      },
    });
    if (periods.length > 0) {
      await tx.villaRatePeriod.createMany({
        data: periods.map((p) => ({
          villaId: id,
          season: p.season,
          isBase: false,
          startDate: toUtc(p.startDate),
          endDate: toUtc(p.endDate),
          label: p.label ?? null,
          supplierCostVnd: BigInt(p.supplierCostVnd),
          marginType: p.marginType,
          marginValue: BigInt(p.marginValue),
          salePriceVnd: BigInt(p.salePriceVnd),
          salePriceKrw: p.salePriceKrw,
          // ADR-0031 — 소비자 직판가(null=Net 폴백)
          consumerMarginType: p.consumerMarginType,
          consumerMarginValue: BigInt(p.consumerMarginValue),
          consumerSalePriceVnd: p.consumerSalePriceVnd != null ? BigInt(p.consumerSalePriceVnd) : null,
          consumerSalePriceKrw: p.consumerSalePriceKrw ?? null,
        })),
      });
    }

    // 감사 로그 — 전체 교체이므로 개수 스냅샷 (요율 변경은 분쟁 증빙 대상)
    await writeAuditLog({
      db: tx,
      userId: actorUserId,
      action: "UPDATE",
      entity: "VillaRatePeriod",
      entityId: id,
      changes: { base: { new: 1 }, periods: { new: periods.length } },
    });

    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 응답에 금액 미포함 — 개수만
  return NextResponse.json({ id, baseCount: 1, periodCount: periods.length });
}
