// Phase B 진입 게이트 조사 — 빌라별 요율 모델 상태 + ADR-0014 검증쿼리 2종.
//   실행: npx tsx scripts/inspect-rate-state.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const villas = await prisma.villa.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      _count: { select: { rates: true, seasonPeriods: true, ratePeriods: true } },
      rates: { select: { season: true } },
      ratePeriods: { select: { isBase: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const globalSeasons = await prisma.seasonPeriod.count();
  console.log(`전역 SeasonPeriod 행 수: ${globalSeasons}`);
  console.log(`빌라 총 ${villas.length}건\n`);
  console.log("name | status | VillaRate(시즌) | VillaSeasonPeriod | VillaRatePeriod(base여부)");
  for (const v of villas) {
    const seasons = v.rates.map((r) => r.season).join(",") || "없음";
    const hasBase = v.ratePeriods.some((r) => r.isBase);
    console.log(
      `${v.name} | ${v.status} | ${seasons} | ${v._count.seasonPeriods} | ${v._count.ratePeriods}(base=${hasBase})`
    );
  }

  // ADR-0014 검증쿼리 ① base 미보유 ACTIVE 빌라
  const noBaseActive = villas.filter(
    (v) => v.status === "ACTIVE" && !v.ratePeriods.some((r) => r.isBase)
  );
  // ② 전역폴백 의존(ratePeriod 0 AND seasonPeriod 0)
  const globalFallback = villas.filter(
    (v) => v._count.ratePeriods === 0 && v._count.seasonPeriods === 0
  );
  console.log(`\n[게이트①] base 미보유 ACTIVE 빌라: ${noBaseActive.length} (0이어야 Phase B 가능)`);
  noBaseActive.forEach((v) => console.log(`   - ${v.name} (rates: ${v.rates.map((r) => r.season).join(",") || "없음"})`));
  console.log(`[게이트②] 전역폴백 의존 빌라: ${globalFallback.length} (0이어야 함)`);
  globalFallback.forEach((v) => console.log(`   - ${v.name} (rates: ${v.rates.map((r) => r.season).join(",") || "없음"})`));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
