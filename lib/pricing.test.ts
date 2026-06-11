import { describe, expect, it } from "vitest";
import { Currency, MarginType, SeasonType } from "@prisma/client";
import {
  MissingRateError,
  assertSaleAmountColumns,
  computeSalePriceVnd,
  quoteStay,
  resolveSeason,
  suggestSalePriceKrw,
  type SeasonPeriodLike,
  type VillaRateLike,
} from "./pricing";

/** @db.Date 규약과 동일하게 UTC 자정 Date 생성 */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const PERIODS: SeasonPeriodLike[] = [
  // 성수기: 7/1 ~ 7/31 (8/1 제외)
  { season: SeasonType.HIGH, startDate: d("2026-07-01"), endDate: d("2026-08-01") },
  // 극성수기(설): 2/15 ~ 2/21 (2/22 제외)
  { season: SeasonType.PEAK, startDate: d("2027-02-15"), endDate: d("2027-02-22") },
];

const RATES: VillaRateLike[] = [
  { season: SeasonType.LOW, supplierCostVnd: 3_000_000n, salePriceVnd: 4_000_000n, salePriceKrw: 230_000 },
  { season: SeasonType.HIGH, supplierCostVnd: 4_500_000n, salePriceVnd: 6_000_000n, salePriceKrw: 350_000 },
  { season: SeasonType.PEAK, supplierCostVnd: 7_000_000n, salePriceVnd: 9_500_000n, salePriceKrw: 550_000 },
];

describe("resolveSeason — [startDate, endDate) half-open + LOW 폴백", () => {
  it("기간 내 날짜는 해당 시즌", () => {
    expect(resolveSeason(d("2026-07-15"), PERIODS)).toBe(SeasonType.HIGH);
    expect(resolveSeason(d("2026-07-01"), PERIODS)).toBe(SeasonType.HIGH); // 시작일 포함
  });

  it("endDate 당일은 기간 밖 (half-open)", () => {
    expect(resolveSeason(d("2026-08-01"), PERIODS)).toBe(SeasonType.LOW);
  });

  it("미등록 날짜는 LOW 폴백", () => {
    expect(resolveSeason(d("2026-03-10"), PERIODS)).toBe(SeasonType.LOW);
    expect(resolveSeason(d("2026-03-10"), [])).toBe(SeasonType.LOW);
  });

  it("기간 겹침 시 PEAK > HIGH 우선", () => {
    const overlap: SeasonPeriodLike[] = [
      { season: SeasonType.HIGH, startDate: d("2026-12-01"), endDate: d("2027-01-10") },
      { season: SeasonType.PEAK, startDate: d("2026-12-30"), endDate: d("2027-01-03") },
    ];
    expect(resolveSeason(d("2026-12-31"), overlap)).toBe(SeasonType.PEAK);
    expect(resolveSeason(d("2026-12-29"), overlap)).toBe(SeasonType.HIGH);
  });
});

describe("quoteStay — 박별 합산 (SPEC F3)", () => {
  it("시즌 경계를 걸친 예약은 박마다 다른 요율 (VND)", () => {
    // 7/30, 7/31 = HIGH, 8/1 = LOW — 3박, 8/2 체크아웃
    const q = quoteStay({
      checkIn: d("2026-07-30"),
      checkOut: d("2026-08-02"),
      saleCurrency: Currency.VND,
      rates: RATES,
      seasonPeriods: PERIODS,
    });
    expect(q.nights).toBe(3);
    expect(q.nightly.map((n) => n.season)).toEqual([SeasonType.HIGH, SeasonType.HIGH, SeasonType.LOW]);
    expect(q.totalSaleVnd).toBe(6_000_000n + 6_000_000n + 4_000_000n);
    expect(q.totalSaleKrw).toBeUndefined(); // VND 거래에 KRW 총액 없음
    expect(q.totalSupplierCostVnd).toBe(4_500_000n + 4_500_000n + 3_000_000n);
    expect(q.nightly.every((n) => n.saleKrw === undefined)).toBe(true);
  });

  it("KRW 채널은 salePriceKrw로 합산 (number)", () => {
    const q = quoteStay({
      checkIn: d("2026-07-30"),
      checkOut: d("2026-08-02"),
      saleCurrency: Currency.KRW,
      rates: RATES,
      seasonPeriods: PERIODS,
    });
    expect(q.totalSaleKrw).toBe(350_000 + 350_000 + 230_000);
    expect(typeof q.totalSaleKrw).toBe("number");
    expect(q.totalSaleVnd).toBeUndefined();
    // 원가는 통화 무관 항상 VND BigInt
    expect(q.totalSupplierCostVnd).toBe(12_000_000n);
  });

  it("전 구간 미등록(비수기)이면 LOW 요율 박별 합산", () => {
    const q = quoteStay({
      checkIn: d("2026-03-01"),
      checkOut: d("2026-03-05"),
      saleCurrency: Currency.VND,
      rates: RATES,
      seasonPeriods: PERIODS,
    });
    expect(q.nights).toBe(4);
    expect(q.totalSaleVnd).toBe(16_000_000n);
  });

  it("해당 시즌 요율 미설정이면 MissingRateError", () => {
    const onlyLow = RATES.filter((r) => r.season === SeasonType.LOW);
    expect(() =>
      quoteStay({
        checkIn: d("2026-07-10"),
        checkOut: d("2026-07-12"),
        saleCurrency: Currency.VND,
        rates: onlyLow,
        seasonPeriods: PERIODS,
      })
    ).toThrow(MissingRateError);
  });

  it("USD 등 지원 외 판매 통화는 명시 거부 — VND 요율로 조용히 합산되지 않음", () => {
    expect(() =>
      quoteStay({
        checkIn: d("2026-07-10"),
        checkOut: d("2026-07-12"),
        saleCurrency: Currency.USD,
        rates: RATES,
        seasonPeriods: PERIODS,
      })
    ).toThrow(RangeError);
  });

  it("0박·역전 구간은 거부 (availability 규약 공유)", () => {
    expect(() =>
      quoteStay({
        checkIn: d("2026-07-10"),
        checkOut: d("2026-07-10"),
        saleCurrency: Currency.VND,
        rates: RATES,
        seasonPeriods: PERIODS,
      })
    ).toThrow(RangeError);
  });
});

describe("computeSalePriceVnd — 마진 자동계산", () => {
  it("PERCENT: 원가 × (100+%) ÷ 100, BigInt 내림", () => {
    expect(computeSalePriceVnd(3_000_000n, MarginType.PERCENT, 30n)).toBe(3_900_000n);
    // 내림 확인: 1,000,001 × 33% = 330,000.33 → 330,000
    expect(computeSalePriceVnd(1_000_001n, MarginType.PERCENT, 33n)).toBe(1_000_001n + 330_000n);
  });

  it("FIXED_VND: 원가 + 고정액", () => {
    expect(computeSalePriceVnd(3_000_000n, MarginType.FIXED_VND, 1_500_000n)).toBe(4_500_000n);
  });

  it("음수 입력 거부", () => {
    expect(() => computeSalePriceVnd(-1n, MarginType.PERCENT, 30n)).toThrow(RangeError);
    expect(() => computeSalePriceVnd(1n, MarginType.FIXED_VND, -5n)).toThrow(RangeError);
  });
});

describe("suggestSalePriceKrw — VND→KRW 환산 제안 (float 금지)", () => {
  it("1 KRW = 17.5 VND일 때 7,000,000₫ → 400,000원", () => {
    expect(suggestSalePriceKrw(7_000_000n, "17.5")).toBe(400_000);
  });

  it("나누어떨어지지 않으면 반올림", () => {
    // 1,000,000 / 17.5000 = 57,142.857… → 57,143
    expect(suggestSalePriceKrw(1_000_000n, "17.5")).toBe(57_143);
    // 1,000,000 / 18.1234 = 55,177.6… → 반올림
    expect(suggestSalePriceKrw(1_000_000n, "18.1234")).toBe(
      Math.round(1_000_000 / 18.1234)
    );
  });

  it("잘못된 환율 형식·0 이하 거부", () => {
    expect(() => suggestSalePriceKrw(1n, "abc")).toThrow(RangeError);
    expect(() => suggestSalePriceKrw(1n, "17.55555")).toThrow(RangeError); // 소수 5자리
    expect(() => suggestSalePriceKrw(1n, "-1")).toThrow(RangeError);
    expect(() => suggestSalePriceKrw(1n, "0")).toThrow(RangeError);
    expect(() => suggestSalePriceKrw(1n, "0.0000")).toThrow(RangeError);
  });
});

describe("assertSaleAmountColumns — 듀얼 컬럼 검증 (ADR-0003)", () => {
  it("KRW: krw만 채우면 통과", () => {
    expect(() => assertSaleAmountColumns(Currency.KRW, { krw: 500_000, vnd: null })).not.toThrow();
    expect(() => assertSaleAmountColumns(Currency.KRW, { krw: 500_000 })).not.toThrow();
  });

  it("VND: vnd만 채우면 통과", () => {
    expect(() => assertSaleAmountColumns(Currency.VND, { vnd: 8_500_000n })).not.toThrow();
  });

  it("KRW인데 krw 누락 또는 vnd 동시 기입 → 거부", () => {
    expect(() => assertSaleAmountColumns(Currency.KRW, { vnd: 8_500_000n })).toThrow();
    expect(() => assertSaleAmountColumns(Currency.KRW, { krw: 500_000, vnd: 8_500_000n })).toThrow();
    expect(() => assertSaleAmountColumns(Currency.KRW, {})).toThrow();
  });

  it("VND인데 vnd 누락 또는 krw 동시 기입 → 거부", () => {
    expect(() => assertSaleAmountColumns(Currency.VND, { krw: 500_000 })).toThrow();
    expect(() => assertSaleAmountColumns(Currency.VND, { krw: 500_000, vnd: 1n })).toThrow();
  });

  it("USD는 어떤 금액 조합이든 거부 (검증 게이트 구멍 방지)", () => {
    expect(() => assertSaleAmountColumns(Currency.USD, { krw: 1, vnd: 1n })).toThrow(RangeError);
    expect(() => assertSaleAmountColumns(Currency.USD, {})).toThrow(RangeError);
  });

  it("0원·0동은 유효한 값 (null과 구분)", () => {
    expect(() => assertSaleAmountColumns(Currency.KRW, { krw: 0 })).not.toThrow();
    expect(() => assertSaleAmountColumns(Currency.VND, { vnd: 0n })).not.toThrow();
  });
});
