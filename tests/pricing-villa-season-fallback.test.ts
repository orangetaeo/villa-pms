import { describe, expect, it, vi } from "vitest";
import { Currency, SeasonType } from "@prisma/client";
import { quoteStayForVilla } from "@/lib/pricing";
import type { DbClient } from "@/lib/availability";

// ADR-0008 D3 회귀 가드: 빌라별 시즌 폴백의 2단계(보유 count + 교차 load)가
//  ① 0건 빌라 = 전역과 동일 견적(회귀 0)
//  ② 보유하나 구간 비교차 → 전역으로 새지 않음(잘못된 폴백 버그 가드, TDA 경고)
// 를 보장한다. resolveSeason 순수함수는 불변이므로 DB 래퍼의 분기만 검증.

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

// 모든 시즌 요율 행 — supplierCost/sale 구분 가능하게 시즌별 다른 값
const RATES = [
  { season: SeasonType.LOW, supplierCostVnd: 1_000_000n, salePriceVnd: 1_200_000n, salePriceKrw: 60_000 },
  { season: SeasonType.HIGH, supplierCostVnd: 2_000_000n, salePriceVnd: 2_400_000n, salePriceKrw: 120_000 },
  { season: SeasonType.PEAK, supplierCostVnd: 3_000_000n, salePriceVnd: 3_600_000n, salePriceKrw: 180_000 },
];

/**
 * 가짜 db — villaSeasonPeriod.count / findMany, seasonPeriod.findMany, villaRate.findMany.
 * spy로 어느 시즌 소스가 쓰였는지 검증.
 */
function makeDb(opts: {
  villaPeriods: { season: SeasonType; startDate: Date; endDate: Date }[];
  globalPeriods: { season: SeasonType; startDate: Date; endDate: Date }[];
}) {
  const intersects = (
    rows: { startDate: Date; endDate: Date }[],
    where: { startDate: { lt: Date }; endDate: { gt: Date } }
  ) =>
    rows.filter(
      (r) =>
        r.startDate.getTime() < where.startDate.lt.getTime() &&
        r.endDate.getTime() > where.endDate.gt.getTime()
    );

  const villaFindMany = vi.fn(async ({ where }: { where: { startDate: { lt: Date }; endDate: { gt: Date } } }) =>
    intersects(opts.villaPeriods, where)
  );
  const globalFindMany = vi.fn(async ({ where }: { where: { startDate: { lt: Date }; endDate: { gt: Date } } }) =>
    intersects(opts.globalPeriods, where)
  );
  const villaCount = vi.fn(async () => opts.villaPeriods.length);

  const db = {
    villaRate: { findMany: vi.fn(async () => RATES) },
    villaSeasonPeriod: { count: villaCount, findMany: villaFindMany },
    seasonPeriod: { findMany: globalFindMany },
  } as unknown as DbClient;

  return { db, villaFindMany, globalFindMany, villaCount };
}

const RANGE = { checkIn: utc("2026-07-10"), checkOut: utc("2026-07-13") }; // 3박

describe("quoteStayForVilla — ADR-0008 빌라별 시즌 폴백", () => {
  it("①-A 빌라 시즌 0건 → 전역 폴백 사용 (글로벌 쿼리 호출, 빌라 findMany 미호출)", async () => {
    // 전역에 7/10~7/20 PEAK → 3박 모두 PEAK
    const globalPeriods = [{ season: SeasonType.PEAK, startDate: utc("2026-07-10"), endDate: utc("2026-07-20") }];
    const { db, villaFindMany, globalFindMany } = makeDb({ villaPeriods: [], globalPeriods });

    const q = await quoteStayForVilla(db, "v1", RANGE, Currency.VND);

    expect(globalFindMany).toHaveBeenCalledTimes(1);
    expect(villaFindMany).not.toHaveBeenCalled(); // 0건이면 빌라 기간 로드 안 함
    expect(q.totalSaleVnd).toBe(3_600_000n * 3n); // PEAK×3
    expect(q.totalSupplierCostVnd).toBe(3_000_000n * 3n);
  });

  it("①-B 회귀 불변식: 0건 빌라 견적 === 전역 직접 견적(동일 전역 달력)", async () => {
    const globalPeriods = [{ season: SeasonType.HIGH, startDate: utc("2026-07-11"), endDate: utc("2026-07-12") }];
    // 빌라 0건 케이스
    const a = makeDb({ villaPeriods: [], globalPeriods });
    const qa = await quoteStayForVilla(a.db, "v1", RANGE, Currency.VND);

    // 같은 전역 달력을 "빌라가 갖고 있었다면"의 기대값 — 7/10 LOW, 7/11 HIGH, 7/12 LOW
    expect(qa.totalSaleVnd).toBe(1_200_000n + 2_400_000n + 1_200_000n);
    expect(qa.nightly.map((n) => n.season)).toEqual([
      SeasonType.LOW,
      SeasonType.HIGH,
      SeasonType.LOW,
    ]);
  });

  it("② 빌라 시즌 보유하나 이번 구간과 비교차 → 전역으로 새지 않음(버그 가드)", async () => {
    // 빌라는 12월에만 PEAK 지정(이번 7월 구간과 안 겹침). 전역엔 7월 PEAK가 있음.
    const villaPeriods = [{ season: SeasonType.PEAK, startDate: utc("2026-12-20"), endDate: utc("2026-12-31") }];
    const globalPeriods = [{ season: SeasonType.PEAK, startDate: utc("2026-07-10"), endDate: utc("2026-07-20") }];
    const { db, villaFindMany, globalFindMany, villaCount } = makeDb({ villaPeriods, globalPeriods });

    const q = await quoteStayForVilla(db, "v1", RANGE, Currency.VND);

    // 보유 count>0 이므로 빌라 집합만 사용 — 전역 쿼리 절대 호출 금지
    expect(villaCount).toHaveBeenCalledTimes(1);
    expect(villaFindMany).toHaveBeenCalledTimes(1);
    expect(globalFindMany).not.toHaveBeenCalled();
    // 빌라 7월 구간엔 시즌 없음 → 전부 LOW 폴백(전역 7월 PEAK로 새면 안 됨)
    expect(q.totalSaleVnd).toBe(1_200_000n * 3n);
    expect(q.nightly.every((n) => n.season === SeasonType.LOW)).toBe(true);
  });

  it("③ 빌라 시즌 보유 + 구간 교차 → 빌라 달력으로 박별 판정", async () => {
    // 7/11만 빌라 PEAK. 전역(7월 HIGH 전체)은 무시돼야 함.
    const villaPeriods = [{ season: SeasonType.PEAK, startDate: utc("2026-07-11"), endDate: utc("2026-07-12") }];
    const globalPeriods = [{ season: SeasonType.HIGH, startDate: utc("2026-07-01"), endDate: utc("2026-07-31") }];
    const { db, globalFindMany } = makeDb({ villaPeriods, globalPeriods });

    const q = await quoteStayForVilla(db, "v1", RANGE, Currency.VND);

    expect(globalFindMany).not.toHaveBeenCalled();
    // 7/10 LOW, 7/11 PEAK, 7/12 LOW (전역 HIGH 무시)
    expect(q.nightly.map((n) => n.season)).toEqual([
      SeasonType.LOW,
      SeasonType.PEAK,
      SeasonType.LOW,
    ]);
    expect(q.totalSaleVnd).toBe(1_200_000n + 3_600_000n + 1_200_000n);
  });
});
