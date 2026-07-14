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
// rate-calendar-fixes §5 — 자체 인라인(digits·isoDate·SEASONS·toUtc·priceFields·premiumData)을 공용
//   fragment로 통합(동작 불변). priceColumns = 구 priceFields에서 season·label·batchId를 뺀 가격 컬럼 집합.
//   buildPriceColumnData = 구 인라인 가격 매핑 + premiumData를 합친 전 가격 컬럼 빌더(동일 시맨틱).
import {
  SEASONS,
  isoDate,
  toUtc,
  priceColumns,
  buildPriceColumnData,
  MAX_RATE_PERIOD_ROWS,
} from "@/lib/rate-period-input";

const labelField = z.string().trim().max(60).nullable().optional();
// rate-calendar-ux — 일괄 작업으로 생성된 행의 그룹 키. 전체 교체에서도 행 단위 보존(옵셔널 통과).
const batchIdField = z.string().max(40).nullable().optional();

// 구 인라인 priceFields = season + priceColumns(가격 컬럼) + label + batchId. 공용 fragment로 대체.
const priceFields = {
  season: z.enum(SEASONS),
  ...priceColumns,
  label: labelField,
  batchId: batchIdField,
};

const baseSchema = z.object(priceFields); // isBase=true — 날짜 없음
const periodSchema = z.object({ ...priceFields, startDate: isoDate, endDate: isoDate });

const patchSchema = z
  .object({
    base: baseSchema, // 기본요금 필수 (없으면 기간 밖 날짜 견적 불가 — ADR-0014 D5)
    periods: z.array(periodSchema).max(MAX_RATE_PERIOD_ROWS),
  })
  .superRefine((data, ctx) => {
    // 각 기간: start < end (half-open). rate-calendar-ux: 겹침 거부는 제거(겹침 허용 — 견적은
    //   lib/pricing.ts resolveRatePeriod의 4단계 승자 규칙으로 밤별 결정). half-open만 유지.
    data.periods.forEach((p, i) => {
      if (toUtc(p.startDate).getTime() >= toUtc(p.endDate).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["periods", i, "endDate"],
          message: "endDate must be after startDate",
        });
      }
    });
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
        // ADR-0031 소비자 직판가·ADR-0042 프리미엄일 컬럼 포함 전 가격 컬럼(BigInt/Int 변환·null 폴백)
        ...buildPriceColumnData(base),
        batchId: base.batchId ?? null, // 보통 base는 수동 → null
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
          ...buildPriceColumnData(p),
          batchId: p.batchId ?? null, // 일괄 작업 유래 행이면 그룹 키 보존
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
