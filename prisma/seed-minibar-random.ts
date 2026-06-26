/**
 * 미니바 재고 랜덤 시드 (수동 1회용) — 모든 ACTIVE 빌라 × 모든 active 미니바 품목에
 *   ① 비치목표(par)  = VillaMinibarStock.qty 를 랜덤 upsert
 *   ② 현재고(onHand) = MinibarStockMovement 원장 ΣqtyDelta 가 목표치가 되도록 ADJUST 1행 추가
 *
 * 실행: npx tsx --env-file=.env prisma/seed-minibar-random.ts
 *
 * ⚠️ 대상 DB = .env DATABASE_URL. 원장(MinibarStockMovement)은 삭제하지 않고 보정행만 추가(멱등 재실행 시
 *    기존 ΣqtyDelta 를 다시 읽어 목표치로 재보정 → 재실행해도 현재고는 새 랜덤 목표치로 수렴).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** [min, max] 정수 균등 랜덤 */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function main() {
  // createdBy 용 운영자 1명 (ADJUST 원장 행 작성자)
  const actor = await prisma.user.findFirst({
    where: { role: { in: ["ADMIN", "OWNER", "MANAGER", "STAFF"] } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (!actor) throw new Error("운영자 사용자가 없습니다 — 먼저 seed 실행 필요");

  const [villas, items] = await Promise.all([
    prisma.villa.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: [{ complex: "asc" }, { name: "asc" }],
    }),
    prisma.minibarItem.findMany({
      where: { active: true },
      select: { id: true, nameKo: true, stockQty: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  if (villas.length === 0 || items.length === 0) {
    console.log(`빌라 ${villas.length} · 품목 ${items.length} — 채울 대상 없음`);
    return;
  }

  // 현재 원장 ΣqtyDelta (빌라×품목) — 보정 delta 계산용
  const sums = await prisma.minibarStockMovement.groupBy({
    by: ["villaId", "minibarItemId"],
    _sum: { qtyDelta: true },
  });
  const onHandMap = new Map<string, number>();
  for (const s of sums) {
    onHandMap.set(`${s.villaId}::${s.minibarItemId}`, s._sum.qtyDelta ?? 0);
  }

  let parRows = 0;
  let movementRows = 0;

  for (const villa of villas) {
    for (const item of items) {
      const key = `${villa.id}::${item.id}`;

      // ① 비치목표(par): 2~12 랜덤
      const par = randInt(2, 12);
      await prisma.villaMinibarStock.upsert({
        where: { villaId_minibarItemId: { villaId: villa.id, minibarItemId: item.id } },
        create: { villaId: villa.id, minibarItemId: item.id, qty: par },
        update: { qty: par },
      });
      parRows += 1;

      // ② 현재고: 0 ~ par+2 랜덤 (일부는 부족, 일부는 가득/초과) → 보정 delta = target − 기존 ΣqtyDelta
      const target = randInt(0, par + 2);
      const existing = onHandMap.get(key) ?? 0;
      const delta = target - existing;
      if (delta !== 0) {
        await prisma.minibarStockMovement.create({
          data: {
            villaId: villa.id,
            minibarItemId: item.id,
            type: "ADJUST",
            qtyDelta: delta,
            note: "랜덤 시드(실사 보정)",
            createdBy: actor.id,
          },
        });
        movementRows += 1;
      }
    }
  }

  console.log(
    `완료 — 빌라 ${villas.length} × 품목 ${items.length}: 비치목표 ${parRows}행 upsert, 재고 보정 ${movementRows}행 추가 (작성자=${actor.name ?? actor.id})`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
