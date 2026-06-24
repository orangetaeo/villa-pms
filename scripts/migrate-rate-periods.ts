// 기존 빌라 → VillaRatePeriod 일괄 변환 (ADR-0014 후속 2/3)
//
// 변환 규칙 (멱등·안전):
//  - 대상: VillaRatePeriod 0건(미전환) + LOW VillaRate 보유(기본요금 형성 가능) + VillaSeasonPeriod 1건 이상.
//    · VillaSeasonPeriod 0건(전역 SeasonPeriod 폴백) 빌라는 SKIP — 전역 겹침을 비겹침으로 변환하는 위험 회피.
//      그대로 두면 dual-read가 구 경로로 견적(무회귀). 필요 시 운영자가 신규 편집기로 개별 전환.
//  - base  = LOW VillaRate → VillaRatePeriod{ isBase:true, season:LOW, 원가·마진·판매가 그대로 }.
//  - 기간  = 각 VillaSeasonPeriod → VillaRatePeriod{ isBase:false, 날짜, season, 그 시즌 VillaRate의 원가·마진·판매가 }.
//            매칭 VillaRate 없는 시즌의 기간은 SKIP(로그) — 신규 모델에선 base로 폴백되므로 가격 누락 없음.
//  - 겹침 가드: VillaSeasonPeriod는 입력단계 겹침 거부(ADR-0008)이나, 만약 겹침 발견 시 그 빌라 전체 SKIP(로그).
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
    if (v._count.seasonPeriods === 0) {
      skipped.push({ villa: v.name, reason: "전역 시즌 폴백(VillaSeasonPeriod 0건) — 구 경로 유지" });
      continue;
    }
    const rateBySeason = new Map<SeasonType, RateBySeason>(
      v.rates.map((r) => [r.season, r as RateBySeason])
    );
    const lowRate = rateBySeason.get("LOW");
    if (!lowRate) {
      skipped.push({ villa: v.name, reason: "LOW VillaRate 없음 — 기본요금 형성 불가" });
      continue;
    }
    if (hasOverlap(v.seasonPeriods)) {
      skipped.push({ villa: v.name, reason: "VillaSeasonPeriod 겹침 — 수동 확인 필요" });
      continue;
    }

    // 기간 행 구성 (매칭 VillaRate 있는 것만)
    const periodRows = v.seasonPeriods.flatMap((p) => {
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

    console.log(`  ✓ [${v.name}] 기본요금 1 + 기간 ${periodRows.length} 생성 ${DRY ? "(예정)" : ""}`);

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
