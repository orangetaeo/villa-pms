// PATCH /api/villas/[id]/rate-periods/cost — SUPPLIER 기간별 원가 입력 (ADR-0014 후속)
// 공급자가 기간 구조(기본요금 + 웃돈 기간 N)와 원가만 입력. 판매가·마진은 운영자 영역.
//  - 재고/마진 비공개: 자기 빌라(supplierId)만(404 동일), 응답·감사에 판매가·마진 절대 미포함.
//  - 권한 분리: salePriceVnd = computeSalePriceVnd(원가, 기존 마진) 서버 재계산(기존 마진 정책 유지).
//    매칭된 기존 기간은 그 행의 마진 보존, 신규 기간은 기본요금(base) 마진을 상속(0마진 위험 방지).
//  - dual-read: 이 PATCH로 VillaRatePeriod가 생기면 그 빌라는 기간별 경로로 전환(구 VillaRate 무시).
//  - 견적중 변경 알림: ACTIVE 제안 포함 시 ADMIN에게 RATE_CHANGED_DURING_PROPOSAL 적재.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { requireAuth } from "@/lib/api-guard";
import { computeSalePriceVnd, suggestSalePriceKrw, getFxVndPerKrw } from "@/lib/pricing";
import { enqueueOperatorNotification } from "@/lib/operator-notify";
import { MarginType, NotificationType, ProposalStatus, type SeasonType } from "@prisma/client";

const vndPositiveDigits = z.string().regex(/^[1-9]\d{0,14}$/); // 원가 — 0 불가
// 공급자 자기 판매가(supplierSalePriceVnd, ADR-0021 §7) — 선택. 양수 문자열 또는 null/미입력(=미설정).
const vndSalePrice = vndPositiveDigits.nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SEASONS = ["LOW", "HIGH", "PEAK"] as const;
const toUtc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const baseSchema = z.object({
  season: z.enum(SEASONS),
  supplierCostVnd: vndPositiveDigits,
  supplierSalePriceVnd: vndSalePrice, // 공급자 자기 판매가(선택)
  label: z.string().trim().max(60).nullable().optional(),
});
const periodSchema = z.object({
  id: z.string().max(40).optional(), // 기존 행 식별(보존). 없으면 신규
  season: z.enum(SEASONS),
  startDate: isoDate,
  endDate: isoDate,
  supplierCostVnd: vndPositiveDigits,
  supplierSalePriceVnd: vndSalePrice, // 공급자 자기 판매가(선택)
  label: z.string().trim().max(60).nullable().optional(),
});

const patchSchema = z
  .object({ base: baseSchema, periods: z.array(periodSchema).max(60) })
  .superRefine((data, ctx) => {
    const valid = data.periods.filter((p, i) => {
      if (toUtc(p.startDate).getTime() >= toUtc(p.endDate).getTime()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["periods", i, "endDate"], message: "endDate must be after startDate" });
        return false;
      }
      return true;
    });
    const sorted = [...valid].sort((a, b) => toUtc(a.startDate).getTime() - toUtc(b.startDate).getTime());
    for (let i = 1; i < sorted.length; i++) {
      if (toUtc(sorted[i].startDate).getTime() < toUtc(sorted[i - 1].endDate).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["periods", data.periods.indexOf(sorted[i]), "startDate"],
          message: "기간이 다른 기간과 겹칩니다",
        });
      }
    }
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const session = g.session;
  if (session.user.role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const supplierId = session.user.id;
  const { id: villaId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { base, periods } = parsed.data;
  // 공급자 자기 판매가 — 양수 문자열이면 BigInt, 없거나 null이면 미설정(null로 명시 저장)
  const toSalePrice = (v: string | null | undefined): bigint | null =>
    v ? BigInt(v) : null;
  const fx = await getFxVndPerKrw(prisma); // tx 밖 1회. 미설정이면 KRW=0(ADMIN 재산정)

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({ where: { id: villaId }, select: { id: true, supplierId: true, name: true } });
    if (!villa || villa.supplierId !== supplierId) return { kind: "NOT_FOUND" as const };

    const existing = await tx.villaRatePeriod.findMany({
      where: { villaId },
      select: { id: true, isBase: true, season: true, supplierCostVnd: true, marginType: true, marginValue: true },
    });
    // 원가 변경 추적 (견적중 알림용 — 호환 payload: season·old/newCostVnd)
    const costChanges: { season: SeasonType; oldCostVnd: bigint; newCostVnd: bigint | null }[] = [];
    const existingBase = existing.find((e) => e.isBase);
    const existingById = new Map(existing.filter((e) => !e.isBase).map((e) => [e.id, e]));
    // 신규 기간이 상속할 마진 = 기본요금 마진. base가 아직 없으면 0마진(판매가=원가, ADMIN이 책정)
    const inheritMargin = existingBase
      ? { marginType: existingBase.marginType, marginValue: existingBase.marginValue }
      : { marginType: MarginType.PERCENT, marginValue: 0n };

    const priceFrom = (cost: bigint, m: { marginType: MarginType; marginValue: bigint }) => {
      const vnd = computeSalePriceVnd(cost, m.marginType, m.marginValue);
      return { salePriceVnd: vnd, salePriceKrw: fx ? suggestSalePriceKrw(vnd, fx) : 0 };
    };

    // ── 기본요금 upsert (마진 보존) ──
    const baseCost = BigInt(base.supplierCostVnd);
    const baseM = existingBase
      ? { marginType: existingBase.marginType, marginValue: existingBase.marginValue }
      : inheritMargin;
    const baseP = priceFrom(baseCost, baseM);
    if (existingBase) {
      if (existingBase.supplierCostVnd !== baseCost) {
        costChanges.push({ season: base.season, oldCostVnd: existingBase.supplierCostVnd, newCostVnd: baseCost });
      }
      await tx.villaRatePeriod.update({
        where: { id: existingBase.id },
        data: {
          season: base.season,
          supplierCostVnd: baseCost,
          supplierSalePriceVnd: toSalePrice(base.supplierSalePriceVnd),
          label: base.label ?? null,
          ...baseP,
        },
      });
    } else {
      await tx.villaRatePeriod.create({
        data: {
          villaId, season: base.season, isBase: true, startDate: null, endDate: null,
          label: base.label ?? null, supplierCostVnd: baseCost,
          supplierSalePriceVnd: toSalePrice(base.supplierSalePriceVnd),
          marginType: baseM.marginType, marginValue: baseM.marginValue, ...baseP,
        },
      });
    }

    // ── 기간 reconcile (매칭=업데이트·마진 보존, 신규=생성·마진 상속) ──
    const keepIds = new Set<string>();
    for (const p of periods) {
      const cost = BigInt(p.supplierCostVnd);
      const match = p.id ? existingById.get(p.id) : undefined;
      const m = match ? { marginType: match.marginType, marginValue: match.marginValue } : inheritMargin;
      const price = priceFrom(cost, m);
      const dates = { startDate: toUtc(p.startDate), endDate: toUtc(p.endDate) };
      if (match) {
        if (match.supplierCostVnd !== cost) {
          costChanges.push({ season: p.season, oldCostVnd: match.supplierCostVnd, newCostVnd: cost });
        }
        await tx.villaRatePeriod.update({
          where: { id: match.id },
          data: {
            season: p.season, ...dates, label: p.label ?? null, supplierCostVnd: cost,
            supplierSalePriceVnd: toSalePrice(p.supplierSalePriceVnd), ...price,
          },
        });
        keepIds.add(match.id);
      } else {
        await tx.villaRatePeriod.create({
          data: {
            villaId, season: p.season, isBase: false, ...dates, label: p.label ?? null,
            supplierCostVnd: cost, supplierSalePriceVnd: toSalePrice(p.supplierSalePriceVnd),
            marginType: m.marginType, marginValue: m.marginValue, ...price,
          },
        });
      }
    }
    // 공급자가 제거한 기존 기간 삭제 (삭제도 원가 변경 추적 — newCost null)
    const toDelete = [...existingById.keys()].filter((idv) => !keepIds.has(idv));
    for (const idv of toDelete) {
      const removed = existingById.get(idv)!;
      costChanges.push({ season: removed.season, oldCostVnd: removed.supplierCostVnd, newCostVnd: null });
    }
    if (toDelete.length > 0) await tx.villaRatePeriod.deleteMany({ where: { id: { in: toDelete } } });

    // ── 견적중 변경 알림 (ADMIN) — 원가가 실제 바뀐 행마다 호환 payload(season·old/newCostVnd) ──
    // cost-alerts 소비처와 동일 형태여야 한다(season·oldCostVnd 필수 — 없으면 그 페이지가 throw).
    const activeProposals =
      costChanges.length > 0
        ? await tx.proposal.findMany({
            where: { status: ProposalStatus.ACTIVE, items: { some: { villaId } } },
            select: { id: true },
          })
        : [];
    if (activeProposals.length > 0) {
      // 운영자 알림 — 그룹 설정 시 (제안×원가변경)당 그룹방 1건, 미설정 시 개별 DM fan-out (ADR-0039).
      // 종전 tx.notification.createMany 직적재를 헬퍼로 전환(그룹 라우팅 단일 원천).
      for (const pr of activeProposals) {
        for (const c of costChanges) {
          await enqueueOperatorNotification({
            db: tx,
            type: NotificationType.RATE_CHANGED_DURING_PROPOSAL,
            payload: {
              villaId,
              villaName: villa.name,
              season: c.season,
              oldCostVnd: c.oldCostVnd.toString(),
              newCostVnd: c.newCostVnd === null ? null : c.newCostVnd.toString(),
              proposalId: pr.id,
              proposalCount: activeProposals.length, // 영향받는 유효 제안 수(문구 표기용)
            },
          });
        }
      }
    }

    // 감사 로그 — 개수만(원가 노출 최소·판매가/마진 절대 미기록)
    await writeAuditLog({
      db: tx,
      userId: supplierId,
      action: "UPDATE",
      entity: "VillaRatePeriod",
      entityId: villaId,
      changes: { base: { new: 1 }, periods: { new: periods.length }, source: { new: "SUPPLIER_COST" } },
    });

    return { kind: "OK" as const, proposalNotified: activeProposals.length > 0 };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 응답 — 공급자는 개수·알림여부만. salePrice*/margin* 절대 미포함(leak-checklist).
  return NextResponse.json({ villaId, baseCount: 1, periodCount: periods.length, proposalNotified: result.proposalNotified });
}
