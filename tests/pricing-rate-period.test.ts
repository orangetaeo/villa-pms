import { describe, expect, it, vi } from "vitest";
import { Currency, SeasonType } from "@prisma/client";
import {
  resolveRatePeriod,
  quoteStayByPeriod,
  quoteStayForVilla,
  pickRepresentativeRate,
  MissingBaseRateError,
  type RatePeriodLike,
} from "@/lib/pricing";
import type { DbClient } from "@/lib/availability";

// ADR-0014 기간별 요금 — resolveRatePeriod/quoteStayByPeriod 순수함수 + quoteStayForVilla dual-read 분기.
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const base: RatePeriodLike = {
  season: SeasonType.LOW,
  isBase: true,
  startDate: null,
  endDate: null,
  supplierCostVnd: 1_000_000n,
  salePriceVnd: 1_200_000n,
  salePriceKrw: 60_000,
};
// 같은 PEAK 시즌이지만 기간·가격이 다른 두 극성수기 (회의 핵심 요구)
const peakTet: RatePeriodLike = {
  season: SeasonType.PEAK,
  isBase: false,
  startDate: utc("2026-02-14"),
  endDate: utc("2026-02-20"),
  supplierCostVnd: 5_000_000n,
  salePriceVnd: 6_000_000n,
  salePriceKrw: 300_000,
};
const peakSummer: RatePeriodLike = {
  season: SeasonType.PEAK,
  isBase: false,
  startDate: utc("2026-07-10"),
  endDate: utc("2026-07-20"),
  supplierCostVnd: 4_500_000n,
  salePriceVnd: 5_500_000n,
  salePriceKrw: 275_000,
};

describe("resolveRatePeriod — 기간 우선, 없으면 기본요금", () => {
  it("기간에 걸린 날짜 → 그 기간 가격 (같은 PEAK라도 기간별 상이)", () => {
    expect(resolveRatePeriod(utc("2026-02-15"), [peakTet, peakSummer], base)).toBe(peakTet);
    expect(resolveRatePeriod(utc("2026-07-11"), [peakTet, peakSummer], base)).toBe(peakSummer);
  });
  it("어떤 기간에도 안 걸린 날짜 → 기본요금", () => {
    expect(resolveRatePeriod(utc("2026-05-01"), [peakTet, peakSummer], base)).toBe(base);
  });
  it("half-open: endDate 당일은 제외 → 기본요금", () => {
    expect(resolveRatePeriod(utc("2026-02-20"), [peakTet], base)).toBe(base);
    expect(resolveRatePeriod(utc("2026-02-19"), [peakTet], base)).toBe(peakTet);
  });
  it("base 없고 매칭도 없으면 MissingBaseRateError", () => {
    expect(() => resolveRatePeriod(utc("2026-05-01"), [peakTet], null)).toThrow(MissingBaseRateError);
  });
  it("겹침 방어 tie-break: 우선순위 높은 시즌, 같으면 startDate 늦은 것", () => {
    const lowOverlap: RatePeriodLike = { ...base, isBase: false, startDate: utc("2026-07-10"), endDate: utc("2026-07-20") };
    // PEAK(peakSummer) vs LOW(lowOverlap) 겹침 → PEAK 우선
    expect(resolveRatePeriod(utc("2026-07-11"), [lowOverlap, peakSummer], base)).toBe(peakSummer);
  });
});

describe("quoteStayByPeriod — 박별 합산", () => {
  it("기간 경계 걸친 숙박: base→PEAK→base 박별 다른 가격 합산 (VND)", () => {
    // 2/13(base) 2/14(peakTet) 2/15(peakTet) = 3박
    const q = quoteStayByPeriod({
      checkIn: utc("2026-02-13"),
      checkOut: utc("2026-02-16"),
      saleCurrency: Currency.VND,
      base,
      periods: [peakTet],
    });
    expect(q.nights).toBe(3);
    expect(q.nightly.map((n) => n.season)).toEqual([SeasonType.LOW, SeasonType.PEAK, SeasonType.PEAK]);
    expect(q.totalSaleVnd).toBe(1_200_000n + 6_000_000n + 6_000_000n);
    expect(q.totalSupplierCostVnd).toBe(1_000_000n + 5_000_000n + 5_000_000n);
  });
  it("KRW 채널 합산", () => {
    const q = quoteStayByPeriod({
      checkIn: utc("2026-07-10"),
      checkOut: utc("2026-07-12"),
      saleCurrency: Currency.KRW,
      base,
      periods: [peakSummer],
    });
    expect(q.totalSaleKrw).toBe(275_000 + 275_000);
    expect(q.totalSaleVnd).toBeUndefined();
  });
});

// ── quoteStayForVilla: VillaRatePeriod 단일 경로 (ADR-0014 Phase B — 구 VillaRate 경로 제거) ──
function makeDb(ratePeriods: RatePeriodLike[]) {
  const nonBase = ratePeriods.filter((p) => !p.isBase);
  const baseRow = ratePeriods.find((p) => p.isBase) ?? null;
  const rpFindMany = vi.fn(async ({ where }: { where: { startDate: { lt: Date }; endDate: { gt: Date } } }) =>
    nonBase.filter(
      (r) => r.startDate!.getTime() < where.startDate.lt.getTime() && r.endDate!.getTime() > where.endDate.gt.getTime()
    )
  );
  const rpFindFirst = vi.fn(async () => baseRow);
  const db = {
    villaRatePeriod: { findFirst: rpFindFirst, findMany: rpFindMany },
  } as unknown as DbClient;
  return { db, rpFindFirst, rpFindMany };
}

describe("pickRepresentativeRate — base 우선 대표가격 선택 (비인지 소비처 일원화)", () => {
  const lowRate = { season: SeasonType.LOW, supplierCostVnd: 1_000_000n };
  const highRate = { season: SeasonType.HIGH, supplierCostVnd: 2_000_000n };

  it("base 기간행 있으면 그것이 대표값", () => {
    const baseRP = { season: SeasonType.LOW, supplierCostVnd: 9_000_000n };
    expect(pickRepresentativeRate(baseRP, [lowRate, highRate])).toBe(baseRP);
  });
  it("base 없으면 fallback 배열 LOW 우선", () => {
    expect(pickRepresentativeRate(null, [highRate, lowRate])).toBe(lowRate);
  });
  it("base·LOW 둘 다 없으면 첫 행", () => {
    expect(pickRepresentativeRate(undefined, [highRate])).toBe(highRate);
  });
  it("아무 요율도 없으면 null", () => {
    expect(pickRepresentativeRate(null, [])).toBeNull();
  });
});

describe("quoteStayForVilla — ADR-0014 단일 경로", () => {
  it("base + 교차 기간으로 박별 합산 (구 VillaRate/SeasonPeriod 미조회)", async () => {
    const { db } = makeDb([base, peakSummer]);
    const q = await quoteStayForVilla(db, "v1", { checkIn: utc("2026-07-09"), checkOut: utc("2026-07-12") }, Currency.VND);
    // 7/9 base, 7/10 peakSummer, 7/11 peakSummer
    expect(q.totalSaleVnd).toBe(1_200_000n + 5_500_000n + 5_500_000n);
  });
  it("base 없으면 MissingBaseRateError", async () => {
    const { db } = makeDb([peakSummer]); // base 없음
    await expect(
      quoteStayForVilla(db, "v1", { checkIn: utc("2026-07-09"), checkOut: utc("2026-07-12") }, Currency.VND)
    ).rejects.toThrow(MissingBaseRateError);
  });
});
