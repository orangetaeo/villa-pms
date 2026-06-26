// POST /api/villas/[id]/minibar-restock — 미니바 입고(RESTOCK)·보정(ADJUST) 기록 (ADR-0019 S1)
// 운영자(isOperator) 전용. SUPPLIER·CLEANER 차단(미니바는 회사 운영 영역, 원칙2).
// ★ 매입 단가(unitCostVnd)는 canViewFinance만 — STAFF가 보내도 무시(원가·마진 비공개).
//   RESTOCK + 단가 입력 시 MinibarItem.costVnd 갱신(회사표준 최근 매입가 → 미니바 마진 통계 활성).
//   현재고는 캐시가 아니라 MinibarStockMovement 원장 ΣqtyDelta로 산출(별도 차감 컬럼 없음).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, canViewFinance, type Role } from "@/lib/permissions";
import {
  validateRestockLine,
  effectivePar,
  restockExceedsPar,
  maxRestockQty,
} from "@/lib/minibar-inventory";

const restockSchema = z.object({
  lines: z
    .array(
      z.object({
        minibarItemId: z.string().min(1).max(40),
        type: z.enum(["RESTOCK", "ADJUST"]),
        qtyDelta: z.number().int().min(-9999).max(9999),
        unitCostVnd: z
          .string()
          .regex(/^\d{1,15}$/)
          .optional()
          .nullable(),
      })
    )
    .min(1)
    .max(200),
  note: z.string().max(500).optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const role = session.user.role as Role | undefined;
  if (!isOperator(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const actorId = session.user.id;
  const canFinance = canViewFinance(role);
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = restockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // 교차필드 검증(순수 로직) — 입고는 양수, 보정은 0 금지, 원가는 RESTOCK 전용 형식
  for (const line of data.lines) {
    const errs = validateRestockLine(line);
    if (errs.length > 0) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", line: line.minibarItemId, codes: errs },
        { status: 400 }
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({ where: { id }, select: { id: true } });
    if (!villa) return { kind: "NOT_FOUND" as const };

    // active 회사표준 품목만 허용 — 미지/비활성 itemId 주입 차단. par 계산용 stockQty도 함께.
    const items = await tx.minibarItem.findMany({
      where: { active: true },
      select: { id: true, stockQty: true },
    });
    const validIds = new Set(items.map((i) => i.id));
    const stdStockMap = new Map(items.map((i) => [i.id, i.stockQty]));

    // ── 비치 목표 초과 입고 차단(2026-06-26) ───────────────────────────────────
    //   미니바=회사 재고. 입고(RESTOCK)는 비치 목표(par)까지만 — 초과 비치 금지.
    //   par = 빌라 오버라이드(VillaMinibarStock.qty) ?? 회사표준(stockQty).
    //   현재고(ΣqtyDelta) + 입고합 > par 이면 그 품목 전체 입고 거부(ADJUST는 상한 미적용).
    const restockTotals = new Map<string, number>();
    for (const line of data.lines) {
      if (line.type !== "RESTOCK" || !validIds.has(line.minibarItemId)) continue;
      restockTotals.set(
        line.minibarItemId,
        (restockTotals.get(line.minibarItemId) ?? 0) + line.qtyDelta
      );
    }
    if (restockTotals.size > 0) {
      const restockIds = [...restockTotals.keys()];
      const [overrides, sums] = await Promise.all([
        tx.villaMinibarStock.findMany({
          where: { villaId: id, minibarItemId: { in: restockIds } },
          select: { minibarItemId: true, qty: true },
        }),
        tx.minibarStockMovement.groupBy({
          by: ["minibarItemId"],
          where: { villaId: id, minibarItemId: { in: restockIds } },
          _sum: { qtyDelta: true },
        }),
      ]);
      const ovrMap = new Map(overrides.map((o) => [o.minibarItemId, o.qty]));
      const onHandMap = new Map(sums.map((s) => [s.minibarItemId, s._sum.qtyDelta ?? 0]));
      for (const [itemId, total] of restockTotals) {
        const par = effectivePar(ovrMap.get(itemId) ?? null, stdStockMap.get(itemId) ?? 0);
        const onHand = onHandMap.get(itemId) ?? 0;
        if (restockExceedsPar(onHand, total, par)) {
          return {
            kind: "PAR_EXCEEDED" as const,
            minibarItemId: itemId,
            par,
            onHand,
            max: maxRestockQty(onHand, par),
          };
        }
      }
    }

    let recorded = 0;
    let costUpdated = 0;
    for (const line of data.lines) {
      if (!validIds.has(line.minibarItemId)) continue; // 미지/비활성 품목 무시(silent drop)

      // 원가는 RESTOCK + canViewFinance일 때만 채택(STAFF가 보내도 무시)
      const applyCost =
        line.type === "RESTOCK" &&
        canFinance &&
        line.unitCostVnd != null &&
        line.unitCostVnd !== "";
      const costBig = applyCost ? BigInt(line.unitCostVnd as string) : null;

      await tx.minibarStockMovement.create({
        data: {
          villaId: id,
          minibarItemId: line.minibarItemId,
          type: line.type,
          qtyDelta: line.qtyDelta,
          unitCostVnd: costBig,
          note: data.note?.trim() || null,
          createdBy: actorId,
        },
      });
      recorded += 1;

      // 회사표준 최근 매입가 갱신 — 미니바 마진 통계 활성(ADR-0019 §4.1)
      if (applyCost) {
        await tx.minibarItem.update({
          where: { id: line.minibarItemId },
          data: { costVnd: costBig },
        });
        costUpdated += 1;
      }
    }

    // 글로벌 규칙 — 변경 추적(라인 수만, 단가 본문 미기록)
    await writeAuditLog({
      db: tx,
      userId: actorId,
      action: "CREATE",
      entity: "Villa",
      entityId: id,
      changes: {
        minibarRestock: { new: recorded },
        minibarCostUpdated: { new: costUpdated },
      },
    });

    return { kind: "OK" as const, recorded, costUpdated };
  });

  if (result.kind === "PAR_EXCEEDED") {
    return NextResponse.json(
      {
        error: "PAR_EXCEEDED",
        minibarItemId: result.minibarItemId,
        par: result.par,
        onHand: result.onHand,
        max: result.max,
      },
      { status: 400 }
    );
  }
  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({
    id,
    recorded: result.recorded,
    costUpdated: result.costUpdated,
  });
}
