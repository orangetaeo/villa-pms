// 기존 빌라 → VillaRatePeriod 일괄 변환 (ADR-0014 후속 2/3)
//
// 변환 규칙 (멱등·안전):
//  - 대상: VillaRatePeriod 0건(미전환) + LOW VillaRate 보유(기본요금 형성 가능).
//  - 기간 소스: 빌라 자체 VillaSeasonPeriod가 있으면 그것, 0건이면 전역 SeasonPeriod의 비-LOW(HIGH/PEAK).
//    · 전역 LOW(예: 04-01~09-30 6개월 배경)는 복제하지 않음 — base(isBase, LOW)가 배경을 담당하고,
//      전역 LOW는 HIGH와 겹쳐(구 모델은 precedence로 해결) 그대로 옮기면 신규 겹침거부에 걸린다.
//      비-LOW만 옮기면 구 resolveSeason(precedence)과 결과 동일·겹침 없음(Phase B 전역폴백 정리, ADR-0014).
//  - base  = LOW VillaRate → VillaRatePeriod{ isBase:true, season:LOW, 원가·마진·판매가 그대로 }.
//  - 기간  = 각 소스 기간 → VillaRatePeriod{ isBase:false, 날짜, season, 그 시즌 VillaRate의 원가·마진·판매가 }.
//            매칭 VillaRate 없는 시즌의 기간은 SKIP(로그) — 신규 모델에선 base로 폴백되므로 가격 누락 없음.
//  - 겹침 가드: 소스 기간에 겹침 발견 시 그 빌라 전체 SKIP(로그).
//  - 트랜잭션: 빌라 단위. 부분 생성 방지.
//
// 실행:  npx tsx scripts/migrate-rate-periods.ts --dry   (미리보기, 쓰기 없음)
//        npx tsx scripts/migrate-rate-periods.ts         (실제 변환)
import { PrismaClient, type SeasonType } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

interface RateBySeason {
  season: SeasonType;
  supplierCostVnd: bigint;
  marginType: "PERCENT" | "FIXED_VND";
  marginValue: bigint;
  salePriceVnd: bigint;
  salePriceKrw: number;
}

function hasOverlap(periods: { startDate: Date; endDate: Date }[]): boolean {
  const sorted = [...periods].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startDate.getTime() < sorted[i - 1].endDate.getTime()) return true;
  }
  return false;
}

async function main() {
  console.log(`[migrate-rate-periods] ${DRY ? "DRY-RUN (쓰기 없음)" : "LIVE 변환"} 시작`);

  // 전역 SeasonPeriod의 비-LOW(HIGH/PEAK)만 — 빌라 자체 시즌이 없을 때 기간 소스로 사용.
  const globalNonLow = (
    await prisma.seasonPeriod.findMany({ select: { season: true, startDate: true, endDate: true, label: true } })
  ).filter((p) => p.season !== "LOW");

  const villas = await prisma.villa.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { ratePeriods: true, seasonPeriods: true } },
      rates: {
        select: { season: true, supplierCostVnd: true, marginType: true, marginValue: true, salePriceVnd: true, salePriceKrw: true },
      },
      seasonPeriods: { select: { season: true, startDate: true, endDate: true, label: true } },
    },
  });

  let converted = 0;
  const skipped: { villa: string; reason: string }[] = [];

  for (const v of villas) {
    if (v._count.ratePeriods > 0) {
      skipped.push({ villa: v.name, reason: "이미 변환됨(VillaRatePeriod 보유)" });
      continue;
    }
    const rateBySeason = new Map<SeasonType, RateBySeason>(
      v.rates.map((r) => [r.season, r as RateBySeason])
    );
    const lowRate = rateBySeason.get("LOW");
    if (!lowRate) {
      skipped.push({ villa: v.name, reason: "LOW VillaRate 없음 — 기본요금 형성 불가(별도 처리 필요)" });
      continue;
    }
    // 기간 소스: 빌라 자체 시즌 있으면 그것, 없으면 전역 비-LOW.
    const sourcePeriods = v.seasonPeriods.length > 0 ? v.seasonPeriods : globalNonLow;
    const sourceLabel = v.seasonPeriods.length > 0 ? "빌라시즌" : "전역폴백";
    if (hasOverlap(sourcePeriods)) {
      skipped.push({ villa: v.name, reason: `${sourceLabel} 기간 겹침 — 수동 확인 필요` });
      continue;
    }

    // 기간 행 구성 (매칭 VillaRate 있는 것만)
    const periodRows = sourcePeriods.flatMap((p) => {
      const rate = rateBySeason.get(p.season);
      if (!rate) {
        console.log(`  · [${v.name}] ${p.season} 기간(${p.startDate.toISOString().slice(0, 10)}~)에 매칭 VillaRate 없음 → 기간 스킵(base 폴백)`);
        return [];
      }
      return [{
        villaId: v.id,
        season: p.season,
        isBase: false,
        startDate: p.startDate,
        endDate: p.endDate,
        label: p.label,
        supplierCostVnd: rate.supplierCostVnd,
        marginType: rate.marginType,
        marginValue: rate.marginValue,
        salePriceVnd: rate.salePriceVnd,
        salePriceKrw: rate.salePriceKrw,
      }];
    });

    console.log(`  ✓ [${v.name}] 기본요금 1 + 기간 ${periodRows.length}(${sourceLabel}) 생성 ${DRY ? "(예정)" : ""}`);

    if (!DRY) {
      await prisma.$transaction(async (tx) => {
        await tx.villaRatePeriod.create({
          data: {
            villaId: v.id,
            season: "LOW",
            isBase: true,
            startDate: null,
            endDate: null,
            label: null,
            supplierCostVnd: lowRate.supplierCostVnd,
            marginType: lowRate.marginType,
            marginValue: lowRate.marginValue,
            salePriceVnd: lowRate.salePriceVnd,
            salePriceKrw: lowRate.salePriceKrw,
          },
        });
        if (periodRows.length > 0) {
          await tx.villaRatePeriod.createMany({ data: periodRows });
        }
      });
    }
    converted++;
  }

  console.log(`\n[migrate-rate-periods] 완료 — 변환 ${converted}건, 스킵 ${skipped.length}건`);
  for (const s of skipped) console.log(`  - SKIP [${s.villa}] ${s.reason}`);
  if (DRY) console.log("\n※ DRY-RUN이었습니다. 실제 변환은 --dry 없이 재실행.");
}

main()
  .catch((e) => {
    console.error("[migrate-rate-periods] 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
