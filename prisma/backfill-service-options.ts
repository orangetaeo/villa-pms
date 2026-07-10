/**
 * 기존 데모 주문(이발소·과일) selectedOptions 백필 (수동 1회용, 시연/테스트 DB 전용)
 *
 *   변형(variant)이 있는 카탈로그 항목인데도 selectedOptions가 비어 코스가 안 뜨던
 *   기존 데모 주문에, 카탈로그 변형 1개를 배정하고 가격·원가를 그 변형으로 정합시킨다.
 *   (실주문은 생성 시 variant 필수라 항상 코스를 가짐 — 이건 직접 삽입된 데모만의 누락 보정)
 *
 *   실행: npx tsx --env-file=.env prisma/backfill-service-options.ts
 *   멱등: selectedOptions가 이미 있는 주문은 건너뜀.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { parseCatalogOptions } from "../lib/service-catalog";
import { priceKrwCeil } from "../lib/service-display";

const prisma = new PrismaClient();
const TYPES: ("BARBER" | "FRUIT")[] = ["BARBER", "FRUIT"];

function isEmpty(s: unknown): boolean {
  return s == null || (Array.isArray(s) && s.length === 0);
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const fxRow = await prisma.appSetting.findUnique({ where: { key: "FX_VND_PER_KRW" } });
  const fx = fxRow?.value ?? "18.87";

  const all = await prisma.serviceOrder.findMany({
    where: { type: { in: TYPES } },
    select: {
      id: true, status: true, quantity: true, costVnd: true,
      catalogItemId: true, selectedOptions: true,
    },
  });
  const targets = all.filter((o) => isEmpty(o.selectedOptions) && o.catalogItemId);

  // 카탈로그 변형 캐시
  const itemIds = [...new Set(targets.map((o) => o.catalogItemId!).filter(Boolean))];
  const items = await prisma.serviceCatalogItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, options: true },
  });
  const variantsByItem = new Map(
    items.map((i) => [i.id, parseCatalogOptions(i.options).variants ?? []])
  );

  let updated = 0;
  let skipped = 0;
  for (const o of targets) {
    const variants = (variantsByItem.get(o.catalogItemId!) ?? []).filter((v) => v.priceVnd);
    if (variants.length === 0) { skipped += 1; continue; }

    const v = pick(variants);
    const qty = o.quantity > 0 ? o.quantity : 1;
    const unitVnd = BigInt(v.priceVnd!);
    const unitCostVnd = v.costVnd ? BigInt(v.costVnd) : 0n;
    const totalVnd = unitVnd * BigInt(qty);
    const totalCostVnd = unitCostVnd * BigInt(qty);
    const priceKrw = priceKrwCeil(totalVnd, fx);

    // 실주문 생성 경로(resolveOrderPricing)와 동일한 스냅샷 형태(가격 포함 — 표시 시 라벨만 추출됨)
    const snapshot = [
      {
        group: "variant",
        key: v.key,
        labelKo: v.labelKo,
        labelI18n: v.labelI18n ?? null,
        priceVnd: v.priceVnd ?? null,
      },
    ];

    await prisma.serviceOrder.update({
      where: { id: o.id },
      data: {
        selectedOptions: snapshot as unknown as Prisma.InputJsonValue,
        priceVnd: totalVnd,
        priceKrw,
        // 기존에 원가가 잡혀 있던(매출·마진 집계 대상) 주문만 변형 원가로 정합. 0이면 0 유지.
        ...(o.costVnd > 0n ? { costVnd: totalCostVnd } : {}),
      },
    });
    updated += 1;
  }

  console.log(`백필 완료 — 대상 ${targets.length}건 중 ${updated}건 코스 배정, ${skipped}건 건너뜀 (fx=${fx})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
