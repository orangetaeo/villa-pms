/**
 * 빌라 요율(공급가/판매가/마진) 누락·비정상 보정 (수동 1회용, 시연/테스트 DB 전용)
 *
 *   모든 VillaRatePeriod를 스캔해 깨진 항목을 "일반적 금액"으로 보정한다.
 *   깨짐 기준: 공급가<=0 | 판매가<=공급가(마진0) | KRW<=0 | 마진값<=0.
 *   보정: 공급가가 비정상(0·10만 단위 아님)이면 침실수×시즌 배수로 일반값 산정,
 *         판매가=공급가×1.2(1만 단위), KRW=판매가/환율 올림(1천 단위), 마진=PERCENT 20%.
 *   정상 항목은 건드리지 않는다(멱등). 기존 예약은 자체 스냅샷이라 영향 없음.
 *
 *   실행: npx tsx --env-file=.env prisma/fix-villa-pricing.ts
 */
import { PrismaClient, MarginType, SeasonType } from "@prisma/client";
const prisma = new PrismaClient();
const FX = 18.87;

function typicalBaseCost(bedrooms: number): bigint {
  if (bedrooms <= 2) return 2_200_000n;
  if (bedrooms === 3) return 2_800_000n;
  if (bedrooms === 4) return 3_800_000n;
  return 5_000_000n;
}
const SEASON_MUL: Record<SeasonType, number> = { LOW: 1.0, HIGH: 1.3, PEAK: 1.6 } as Record<SeasonType, number>;
const round = (v: number, unit: number) => BigInt(Math.round(v / unit) * unit);
const isJunkCost = (c: bigint) => c <= 0n || c % 100_000n !== 0n; // 실제 원가는 10만 단위 라운드

async function main() {
  const villas = await prisma.villa.findMany({
    select: { id: true, name: true, bedrooms: true, ratePeriods: { select: { id: true, isBase: true, season: true, supplierCostVnd: true, salePriceVnd: true, salePriceKrw: true, marginValue: true } } },
  });

  let fixed = 0;
  const touched: string[] = [];
  for (const v of villas) {
    for (const p of v.ratePeriods) {
      const broken = p.supplierCostVnd <= 0n || p.salePriceVnd <= p.supplierCostVnd || p.salePriceKrw <= 0 || p.marginValue <= 0n;
      if (!broken) continue;

      // 공급가 — 정상(10만 단위·양수)이면 유지, 아니면 침실수×시즌 일반값
      let cost = p.supplierCostVnd;
      if (isJunkCost(cost)) {
        const mul = SEASON_MUL[p.season] ?? 1.0;
        cost = round(Number(typicalBaseCost(v.bedrooms)) * mul, 100_000);
      }
      const saleVnd = round(Number(cost) * 1.2, 10_000); // 마진 20%
      const saleKrw = Math.ceil(Number(saleVnd) / FX / 1000) * 1000;

      await prisma.villaRatePeriod.update({
        where: { id: p.id },
        data: { supplierCostVnd: cost, salePriceVnd: saleVnd, salePriceKrw: saleKrw, marginType: MarginType.PERCENT, marginValue: 20n },
      });
      fixed += 1;
      if (!touched.includes(v.name)) touched.push(v.name);
    }
  }
  console.log(`완료 — 보정 ${fixed}개 요율기간 (빌라: ${touched.join(", ") || "없음"})`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
