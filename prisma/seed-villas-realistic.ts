/**
 * 현실적 빌라 등록 시드 (시연/테스트 DB 전용) — 정상 6개에 더해 ~61개 추가해 총 ~67 ACTIVE.
 *   푸꾸옥 주요 단지명 + 침실수별 일반 원가·판매가(마진 20%)·KRW 요율(기본 요율기간).
 *   id 접두 `demo-rv-` 고정 upsert(멱등). 요율은 빌라별 deleteMany 후 base 1행 생성.
 *   실행: npx tsx --env-file=.env prisma/seed-villas-realistic.ts
 */
import { PrismaClient, VillaStatus, MarginType } from "@prisma/client";
const prisma = new PrismaClient();
const FX = 18.87;
const TARGET_NEW = 61;

const SUPPLIERS = ["u-tyy-villa-manager", "seed-supplier-pilot"];
const COMPLEXES = [
  { ko: "쏘나씨", vi: "Sonasea", unit: "V" },
  { ko: "썬셋 사나토", vi: "Sunset Sanato", unit: "A" },
  { ko: "그린베이", vi: "Greenbay", unit: "B" },
  { ko: "마리나 베이", vi: "Marina Bay", unit: "C" },
  { ko: "프리미어 빌리지", vi: "Premier Village", unit: "P" },
  { ko: "빈오아시스", vi: "Vin Oasis", unit: "O" },
  { ko: "바이쯔엉", vi: "Bai Truong", unit: "T" },
  { ko: "사오비치", vi: "Sao Beach", unit: "S" },
];
// 침실수별 일반 원가(VND/박)
const COST_BY_BED: Record<number, number> = { 2: 2_200_000, 3: 2_800_000, 4: 3_800_000, 5: 5_000_000, 6: 6_500_000 };

function randInt(min: number, max: number): number { return min + Math.floor(Math.random() * (max - min + 1)); }
function pick<T>(a: readonly T[]): T { return a[Math.floor(Math.random() * a.length)]; }
const round = (v: number, u: number) => Math.round(v / u) * u;

async function main() {
  const unitCounter = new Map<string, number>(); // 단지별 호수 카운터
  let created = 0, rateRows = 0;

  for (let i = 1; i <= TARGET_NEW; i++) {
    const c = COMPLEXES[i % COMPLEXES.length];
    const n = (unitCounter.get(c.unit) ?? 20) + 1;
    unitCounter.set(c.unit, n);

    const bedrooms = randInt(2, 6);
    const bathrooms = Math.max(1, bedrooms - (Math.random() < 0.4 ? 1 : 0));
    const maxGuests = bedrooms * 2 + randInt(0, 2);
    const id = `demo-rv-${String(i).padStart(3, "0")}`;
    const name = `${c.ko} ${c.unit}${n}`;
    const nameVi = `${c.vi} ${c.unit}${n}`;

    await prisma.villa.upsert({
      where: { id },
      update: { name, nameVi, complex: c.ko, bedrooms, bathrooms, maxGuests, status: VillaStatus.ACTIVE, isSellable: true },
      create: {
        id, supplierId: pick(SUPPLIERS), name, nameVi, complex: c.ko,
        address: "Phú Quốc, Kiên Giang", bedrooms, bathrooms, maxGuests,
        hasPool: Math.random() < 0.7, breakfastAvailable: Math.random() < 0.6,
        status: VillaStatus.ACTIVE, isSellable: true, icalImportUrls: [],
        createdAt: new Date(Date.UTC(2026, 0, randInt(1, 28))),
      },
    });
    created += 1;

    // 기본 요율(마진 20%) — 침실수별 일반 원가 ±10% jitter
    const baseCost = COST_BY_BED[bedrooms] ?? 3_000_000;
    const cost = BigInt(round(baseCost * (0.9 + Math.random() * 0.2), 100_000));
    const saleVnd = BigInt(round(Number(cost) * 1.2, 10_000));
    const saleKrw = Math.ceil(Number(saleVnd) / FX / 1000) * 1000;

    await prisma.villaRatePeriod.deleteMany({ where: { villaId: id } });
    await prisma.villaRatePeriod.create({
      data: { villaId: id, season: "LOW", isBase: true, supplierCostVnd: cost, marginType: MarginType.PERCENT, marginValue: 20n, salePriceVnd: saleVnd, salePriceKrw: saleKrw },
    });
    rateRows += 1;
  }

  const active = await prisma.villa.count({ where: { status: "ACTIVE" } });
  console.log(`완료 — 빌라 ${created}개 upsert(요율 ${rateRows}행). 현재 ACTIVE 빌라 ${active}개`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
