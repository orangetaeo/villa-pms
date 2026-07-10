/**
 * 미니바 재고 "딱 3개만 부족" 정리 시드 (수동 1회용, 테스터 데이터용)
 *
 *   모든 ACTIVE 빌라 × active 미니바 품목의 현재고(ΣqtyDelta)를
 *     · 기본: 비치목표(par)와 동일하게 = 가득 채움(부족 아님)
 *     · 무작위 3개 (빌라×품목) 조합만 par − 1~2 로 = 부족(low) 상태
 *   ADJUST 원장 1행씩 추가(원장은 삭제하지 않음 — 멱등: 재실행 시 새 3개로 재수렴).
 *
 * 실행: npx tsx --env-file=.env prisma/seed-minibar-short3.ts
 *
 * ⚠️ 대상 DB = .env DATABASE_URL. 부족 판정 = 현재고 < par (lib/minibar-inventory.isLowStock).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SHORT_COUNT = 3; // 부족으로 만들 (빌라×품목) 조합 수

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function main() {
  const actor = await prisma.user.findFirst({
    where: { role: { in: ["ADMIN", "OWNER", "MANAGER", "STAFF"] } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (!actor) throw new Error("운영자 사용자가 없습니다 — 먼저 seed 실행 필요");

  const [villas, items, overrides, sums] = await Promise.all([
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
    prisma.villaMinibarStock.findMany({
      select: { villaId: true, minibarItemId: true, qty: true },
    }),
    prisma.minibarStockMovement.groupBy({
      by: ["villaId", "minibarItemId"],
      _sum: { qtyDelta: true },
    }),
  ]);

  if (villas.length === 0 || items.length === 0) {
    console.log(`빌라 ${villas.length} · 품목 ${items.length} — 대상 없음`);
    return;
  }

  const key = (v: string, i: string) => `${v}::${i}`;
  const parMap = new Map<string, number>();
  for (const o of overrides) parMap.set(key(o.villaId, o.minibarItemId), o.qty);
  const onHandMap = new Map<string, number>();
  for (const s of sums) onHandMap.set(key(s.villaId, s.minibarItemId), s._sum.qtyDelta ?? 0);

  // 전체 (빌라×품목) 조합 — par>0 인 것만 부족 후보 (par=0이면 부족 불가)
  type Combo = { villaId: string; villaName: string; itemId: string; itemKo: string; par: number };
  const combos: Combo[] = [];
  for (const v of villas) {
    for (const it of items) {
      const par = parMap.get(key(v.id, it.id)) ?? it.stockQty;
      combos.push({ villaId: v.id, villaName: v.name, itemId: it.id, itemKo: it.nameKo, par });
    }
  }

  // 부족으로 만들 3개 무작위 선택 (par>=1 인 후보 중)
  const eligible = combos.filter((c) => c.par >= 1);
  const shortIdx = new Set<string>();
  const pool = [...eligible];
  for (let n = 0; n < SHORT_COUNT && pool.length > 0; n++) {
    const i = randInt(0, pool.length - 1);
    const c = pool.splice(i, 1)[0];
    shortIdx.add(key(c.villaId, c.itemId));
  }

  let movementRows = 0;
  const shortReport: string[] = [];

  for (const c of combos) {
    const k = key(c.villaId, c.itemId);
    const isShort = shortIdx.has(k);
    let target: number;
    if (isShort) {
      // par − 1~2 (단, 최소 0). par=1이면 0으로 부족.
      const deficit = Math.min(randInt(1, 2), c.par);
      target = c.par - deficit;
      shortReport.push(`${c.villaName} / ${c.itemKo}: 현재고 ${target} / 목표 ${c.par} (−${deficit})`);
    } else {
      target = c.par; // 가득
    }
    const existing = onHandMap.get(k) ?? 0;
    const delta = target - existing;
    if (delta !== 0) {
      await prisma.minibarStockMovement.create({
        data: {
          villaId: c.villaId,
          minibarItemId: c.itemId,
          type: "ADJUST",
          qtyDelta: delta,
          note: isShort ? "테스트 보정(부족)" : "테스트 보정(가득)",
          createdBy: actor.id,
        },
      });
      movementRows += 1;
    }
  }

  console.log(
    `완료 — 조합 ${combos.length}개 중 부족 ${shortReport.length}개로 설정, 나머지는 가득. 원장 ${movementRows}행 추가.`
  );
  console.log("부족 품목:");
  for (const line of shortReport) console.log("  · " + line);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
