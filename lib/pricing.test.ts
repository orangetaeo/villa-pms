import { describe, expect, it } from "vitest";
import { Currency, MarginType } from "@prisma/client";
import {
  assertSaleAmountColumns,
  computeSalePriceVnd,
  suggestSalePriceKrw,
} from "./pricing";

// ADR-0014 Phase B: 구 시즌 기반 quoteStay/resolveSeason 제거 → 기간별 경로는
//   pricing-rate-period.test.ts(resolveRatePeriod/quoteStayByPeriod/quoteStayForVilla)가 담당.

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
