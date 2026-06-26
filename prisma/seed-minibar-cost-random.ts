/**
 * 미니바 입고가(costVnd) 랜덤 샘플 시드 (수동 1회용) — 전 active MinibarItem에
 *   입고가 = 판매가(unitPriceVnd) × 랜덤(0.4~0.7), 1000동 단위 반올림으로 채운다(항상 판매가 미만).
 *
 * 실행: npx tsx --env-file=.env prisma/seed-minibar-cost-random.ts
 *
 * ⚠️ 대상 DB = .env DATABASE_URL. 멱등 아님(재실행마다 새 랜덤값). 입고가 입력 시 미니바 마진 통계 활성.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** [min,max] 실수 랜덤 */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function main() {
  const items = await prisma.minibarItem.findMany({
    where: { active: true },
    select: { id: true, nameKo: true, unitPriceVnd: true },
    orderBy: { sortOrder: "asc" },
  });
  if (items.length === 0) {
    console.log("active 미니바 품목 없음 — 채울 대상 없음");
    return;
  }

  for (const it of items) {
    const sale = Number(it.unitPriceVnd); // VND 동(정수). Number 안전범위 내(미니바 단가).
    const ratio = rand(0.4, 0.7);
    // 1000동 단위 반올림, 최소 1000동, 판매가 미만 보장
    let cost = Math.round((sale * ratio) / 1000) * 1000;
    if (cost < 1000) cost = 1000;
    if (cost >= sale) cost = Math.max(1000, sale - 1000);

    await prisma.minibarItem.update({
      where: { id: it.id },
      data: { costVnd: BigInt(cost) },
    });
    console.log(
      ` - ${it.nameKo}: 판매 ${sale.toLocaleString()}₫ → 입고 ${cost.toLocaleString()}₫ (${Math.round(
        (cost / sale) * 100
      )}%)`
    );
  }
  console.log(`완료 — ${items.length}개 품목 입고가 랜덤 설정`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
