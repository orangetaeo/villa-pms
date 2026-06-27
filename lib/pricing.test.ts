import { describe, expect, it } from "vitest";
import { Currency, MarginType, SeasonType } from "@prisma/client";
import {
  assertSaleAmountColumns,
  computeSalePriceVnd,
  suggestSalePriceKrw,
  usdToVndSnapshot,
  quoteSupplierSaleForVilla,
  MissingSupplierPriceError,
  MissingBaseRateError,
} from "./pricing";
import type { DbClient } from "./availability";

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

  it("USD(Phase 2): usd만 채우면 통과, krw·vnd 동시 기입은 거부", () => {
    expect(() => assertSaleAmountColumns(Currency.USD, { usd: 1500 })).not.toThrow();
    expect(() => assertSaleAmountColumns(Currency.USD, { usd: 1500, krw: 1 })).toThrow();
    expect(() => assertSaleAmountColumns(Currency.USD, { usd: 1500, vnd: 1n })).toThrow();
    expect(() => assertSaleAmountColumns(Currency.USD, {})).toThrow(); // usd 누락
  });

  it("KRW/VND 거래에 usd 섞이면 거부 (검증 게이트 구멍 방지)", () => {
    expect(() => assertSaleAmountColumns(Currency.KRW, { krw: 1, usd: 1 })).toThrow();
    expect(() => assertSaleAmountColumns(Currency.VND, { vnd: 1n, usd: 1 })).toThrow();
  });

  it("0원·0동은 유효한 값 (null과 구분)", () => {
    expect(() => assertSaleAmountColumns(Currency.KRW, { krw: 0 })).not.toThrow();
    expect(() => assertSaleAmountColumns(Currency.VND, { vnd: 0n })).not.toThrow();
  });
});

describe("usdToVndSnapshot — USD→VND 환산 (Phase 2, float 금지)", () => {
  it("1 USD = 25,400 VND일 때 1,500$ → 38,100,000₫", () => {
    expect(usdToVndSnapshot(1_500, "25400")).toBe(38_100_000n);
  });

  it("소수 4자리 환율·half-up 반올림", () => {
    // 3 × 25400.3333 = 76200.9999 → half-up 76201
    expect(usdToVndSnapshot(3, "25400.3333")).toBe(76_201n);
  });

  it("0달러는 0동", () => {
    expect(usdToVndSnapshot(0, "25400")).toBe(0n);
  });

  it("음수·비정수 USD 거부", () => {
    expect(() => usdToVndSnapshot(-1, "25400")).toThrow(RangeError);
    expect(() => usdToVndSnapshot(1.5, "25400")).toThrow(RangeError);
  });

  it("잘못된 환율 형식·0 이하 거부", () => {
    expect(() => usdToVndSnapshot(1, "abc")).toThrow(RangeError);
    expect(() => usdToVndSnapshot(1, "25400.55555")).toThrow(RangeError); // 소수 5자리
    expect(() => usdToVndSnapshot(1, "0")).toThrow(RangeError);
    expect(() => usdToVndSnapshot(1, "-1")).toThrow(RangeError);
  });
});

// ===================== quoteSupplierSaleForVilla (F10 Phase B) =====================

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** villaRatePeriod만 가진 최소 DbClient 목 — base(isBase) + 웃돈 기간들 */
function makePricingDb(
  base: { season: SeasonType; supplierSalePriceVnd: bigint | null } | null,
  periods: Array<{
    season: SeasonType;
    startDate: Date;
    endDate: Date;
    supplierSalePriceVnd: bigint | null;
  }> = []
): DbClient {
  const baseRow = base
    ? { season: base.season, isBase: true, startDate: null, endDate: null, supplierSalePriceVnd: base.supplierSalePriceVnd }
    : null;
  const periodRows = periods.map((p) => ({ ...p, isBase: false }));
  return {
    villaRatePeriod: {
      findFirst: async () => baseRow,
      // 라우트 where(startDate<lt,endDate>gt)는 목에서 무시 — 전부 반환하고 resolveRatePeriod가 날짜 판정
      findMany: async () => periodRows,
    },
  } as unknown as DbClient;
}

describe("quoteSupplierSaleForVilla — 공급자 자기 판매가 견적 (supplierSalePriceVnd만)", () => {
  it("균일가: 3박 모두 base 적용 → 합산", async () => {
    const db = makePricingDb({ season: SeasonType.LOW, supplierSalePriceVnd: 2_000_000n });
    const q = await quoteSupplierSaleForVilla(db, "v1", {
      checkIn: d("2026-07-01"),
      checkOut: d("2026-07-04"),
    });
    expect(q.totalVnd).toBe(6_000_000n);
    expect(q.nightlyVnd).toEqual([2_000_000n, 2_000_000n, 2_000_000n]);
  });

  it("기간 경계: 웃돈 기간에 걸친 박만 기간가, 나머지는 base", async () => {
    // base 2,000,000 / 7/2~7/3(1박)만 PEAK 5,000,000
    const db = makePricingDb({ season: SeasonType.LOW, supplierSalePriceVnd: 2_000_000n }, [
      { season: SeasonType.PEAK, startDate: d("2026-07-02"), endDate: d("2026-07-03"), supplierSalePriceVnd: 5_000_000n },
    ]);
    const q = await quoteSupplierSaleForVilla(db, "v1", {
      checkIn: d("2026-07-01"),
      checkOut: d("2026-07-04"),
    });
    // 7/1 base, 7/2 PEAK, 7/3 base
    expect(q.nightlyVnd).toEqual([2_000_000n, 5_000_000n, 2_000_000n]);
    expect(q.totalVnd).toBe(9_000_000n);
  });

  it("적용 기간의 supplierSalePriceVnd 미설정 → MissingSupplierPriceError(season·date)", async () => {
    const db = makePricingDb({ season: SeasonType.LOW, supplierSalePriceVnd: 2_000_000n }, [
      { season: SeasonType.HIGH, startDate: d("2026-07-02"), endDate: d("2026-07-03"), supplierSalePriceVnd: null },
    ]);
    await expect(
      quoteSupplierSaleForVilla(db, "v1", { checkIn: d("2026-07-01"), checkOut: d("2026-07-04") })
    ).rejects.toBeInstanceOf(MissingSupplierPriceError);
  });

  it("base 미설정(전체 미설정) → MissingSupplierPriceError (base 날짜에서 막힘)", async () => {
    const db = makePricingDb({ season: SeasonType.LOW, supplierSalePriceVnd: null });
    await expect(
      quoteSupplierSaleForVilla(db, "v1", { checkIn: d("2026-07-01"), checkOut: d("2026-07-02") })
    ).rejects.toBeInstanceOf(MissingSupplierPriceError);
  });

  it("base 행 자체 없음 → MissingBaseRateError", async () => {
    const db = makePricingDb(null);
    await expect(
      quoteSupplierSaleForVilla(db, "v1", { checkIn: d("2026-07-01"), checkOut: d("2026-07-02") })
    ).rejects.toBeInstanceOf(MissingBaseRateError);
  });
});
