// PATCH /api/villas/[id]/minibar-stock — 빌라별 미니바 비치수량 오버라이드 (#2c)
// 운영자(isOperator) 전용. SUPPLIER 차단(미니바는 우리 회사 운영 — 공급자 미관여, 원칙2).
// ★ 수량(qty)만 저장한다. 가격(unitPriceVnd)은 일절 조회·수정하지 않는다(회사표준 MinibarItem 유지).
//   qty === 회사표준 stockQty 이면 오버라이드 행 삭제(= 표준 추종), 다르면 upsert.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

const stockPatchSchema = z.object({
  stocks: z
    .array(
      z.object({
        minibarItemId: z.string().min(1).max(40),
        qty: z.number().int().min(0).max(9999),
      })
    )
    .max(200),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 운영자만 — SUPPLIER·CLEANER 차단(미니바는 회사 운영 영역)
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const actorId = session.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = stockPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({ where: { id }, select: { id: true } });
    if (!villa) return { kind: "NOT_FOUND" as const };

    // active 회사표준 품목만 허용 — 미지/비활성 itemId 주입 차단 + 표준 stockQty 비교용
    const items = await tx.minibarItem.findMany({
      where: { active: true },
      select: { id: true, stockQty: true },
    });
    const stdMap = new Map(items.map((i) => [i.id, i.stockQty]));

    let changed = 0;
    for (const s of data.stocks) {
      const std = stdMap.get(s.minibarItemId);
      if (std === undefined) continue; // 미지/비활성 품목은 무시(silent drop)
      if (s.qty === std) {
        // 표준과 같으면 오버라이드 제거 → 이후 표준 수량 변경을 자동 추종
        const del = await tx.villaMinibarStock.deleteMany({
          where: { villaId: id, minibarItemId: s.minibarItemId },
        });
        changed += del.count;
      } else {
        await tx.villaMinibarStock.upsert({
          where: { villaId_minibarItemId: { villaId: id, minibarItemId: s.minibarItemId } },
          create: { villaId: id, minibarItemId: s.minibarItemId, qty: s.qty },
          update: { qty: s.qty },
        });
        changed += 1;
      }
    }

    // 글로벌 규칙 — 변경 추적(가격 미포함, 수량 항목 수만)
    await writeAuditLog({
      db: tx,
      userId: actorId,
      action: "UPDATE",
      entity: "Villa",
      entityId: id,
      changes: { minibarStock: { new: data.stocks.length } },
    });

    return { kind: "OK" as const, changed };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ id, changed: result.changed });
}
