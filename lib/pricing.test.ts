import { describe, expect, it } from "vitest";
import { BookingChannel, Currency, MarginType, SeasonType } from "@prisma/client";
import {
  assertSaleAmountColumns,
  computeSalePriceVnd,
  computeConsumerSalePriceVnd,
  priceTierForChannel,
  suggestSalePriceKrw,
  suggestSalePriceUsd,
  usdToVndSnapshot,
  quoteSupplierSaleForVilla,
  quoteStayForVilla,
  pickLowestSalePrice,
  pickLowestSupplierCost,
  MissingSupplierPriceError,
  MissingBaseRateError,
} from "./pricing";
import { tierForCounterparty } from "./zalo-counterparty";
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

describe("pickLowestSalePrice — 시즌 우선-else-base 판매가 >0 최저값 (VND 전환, 계약 A/D1)", () => {
  // isBase 기본 false(시즌 행), 세 번째 인자로 base 지정.
  const r = (krw: number, vnd: bigint, isBase = false) => ({ isBase, salePriceKrw: krw, salePriceVnd: vnd });

  it("KRW: 시즌 행 중 최소를 고르고 base=0은 제외", () => {
    // base=0(초기화) + 시즌가 2개 → 최저 시즌가
    const out = pickLowestSalePrice([r(0, 0n, true), r(120_000, 2_000_000n), r(90_000, 1_500_000n)], true);
    expect(out).toEqual({ krw: 90_000, vnd: null });
  });

  it("VND: 시즌 행 중 최소, 선택 통화만 채우고 반대편은 null", () => {
    const out = pickLowestSalePrice([r(0, 0n, true), r(120_000, 2_000_000n), r(90_000, 1_500_000n)], false);
    expect(out).toEqual({ krw: null, vnd: 1_500_000n });
  });

  it("★VND base가 원가와 같아도(시즌 더 비쌈) 시즌 최저가를 대표가로 — base 누출 방지", () => {
    // 실데이터: base VND=10,000,000(원가와 동일, 마진0), 시즌 11~12.5M → 시즌 최저 11M(더 낮은 base 제외)
    const rows = [r(0, 10_000_000n, true), r(0, 12_500_000n), r(0, 11_000_000n)];
    expect(pickLowestSalePrice(rows, false)).toEqual({ krw: null, vnd: 11_000_000n });
  });

  it("시즌 행이 없으면 base로 폴백 (base-only)", () => {
    expect(pickLowestSalePrice([r(618_000, 10_000_000n, true)], true)).toEqual({ krw: 618_000, vnd: null });
    expect(pickLowestSalePrice([r(618_000, 10_000_000n, true)], false)).toEqual({ krw: null, vnd: 10_000_000n });
  });

  it("전부 0/미설정이면 null (모달·본문 가격 생략)", () => {
    expect(pickLowestSalePrice([r(0, 0n, true), r(0, 0n)], true)).toBeNull();
    expect(pickLowestSalePrice([], false)).toBeNull();
  });

  it("혼합: KRW는 있고 VND는 전부 0이면 통화별로 결과가 갈린다", () => {
    const rows = [r(0, 0n, true), r(80_000, 0n)];
    expect(pickLowestSalePrice(rows, true)).toEqual({ krw: 80_000, vnd: null });
    expect(pickLowestSalePrice(rows, false)).toBeNull();
  });
});

describe("pickLowestSalePrice — 가격 계층(ADR-0031, 2026-07-24)", () => {
  // net·consumer를 모두 가진 행. consumer=null이면 net 폴백을 검증.
  const rc = (net: bigint, consumer: bigint | null, isBase = false) => ({
    isBase,
    salePriceKrw: 0,
    salePriceVnd: net,
    consumerSalePriceVnd: consumer,
    consumerSalePriceKrw: null,
  });

  it("CONSUMER 계층은 소비자가를 쓰고, NET/미지정은 도매가를 쓴다 (base-only)", () => {
    // 실측 M villa V01 비수기: Net 11,000,000 / 소비자 12,100,000
    const rows = [rc(11_000_000n, 12_100_000n, true)];
    expect(pickLowestSalePrice(rows, false, "CONSUMER")).toEqual({ krw: null, vnd: 12_100_000n });
    expect(pickLowestSalePrice(rows, false, "NET")).toEqual({ krw: null, vnd: 11_000_000n });
    // tier 미지정 = NET(하위호환)
    expect(pickLowestSalePrice(rows, false)).toEqual({ krw: null, vnd: 11_000_000n });
  });

  it("CONSUMER인데 소비자가 null이면 Net으로 폴백", () => {
    const rows = [rc(11_000_000n, null, true)];
    expect(pickLowestSalePrice(rows, false, "CONSUMER")).toEqual({ krw: null, vnd: 11_000_000n });
  });

  it("CONSUMER 계층도 시즌 우선-else-base — 시즌 소비자가 최저를 대표가로", () => {
    // base(net 11M/consumer 12.1M) + 시즌(net 12M/consumer 13.2M) → 시즌 우선 → 소비자 13.2M
    const rows = [rc(11_000_000n, 12_100_000n, true), rc(12_000_000n, 13_200_000n)];
    expect(pickLowestSalePrice(rows, false, "CONSUMER")).toEqual({ krw: null, vnd: 13_200_000n });
    // 같은 rows를 NET으로 보면 시즌 도매가 12M
    expect(pickLowestSalePrice(rows, false, "NET")).toEqual({ krw: null, vnd: 12_000_000n });
  });

  it("CONSUMER 시즌 소비자가만 null이면 그 행은 net 유효가로 평가(폴백)", () => {
    // 시즌 소비자가 null → 유효가=net 12M(>0이라 시즌 풀에 포함). base 소비자가 12.1M는 무시(시즌 우선).
    const rows = [rc(11_000_000n, 12_100_000n, true), rc(12_000_000n, null)];
    expect(pickLowestSalePrice(rows, false, "CONSUMER")).toEqual({ krw: null, vnd: 12_000_000n });
  });

  it("consumer 필드 없는 기존 입력도 NET 계층에서 그대로 동작(하위호환)", () => {
    const rows = [{ isBase: true, salePriceKrw: 618_000, salePriceVnd: 10_000_000n }];
    expect(pickLowestSalePrice(rows, false, "NET")).toEqual({ krw: null, vnd: 10_000_000n });
    expect(pickLowestSalePrice(rows, false)).toEqual({ krw: null, vnd: 10_000_000n });
  });
});

describe("tierForCounterparty — 상대 타입 → 가격 계층 (ADR-0031)", () => {
  it("CUSTOMER(일반소비자) → CONSUMER", () => {
    expect(tierForCounterparty("CUSTOMER")).toBe("CONSUMER");
  });
  it("여행사·랜드사(도매) → NET", () => {
    expect(tierForCounterparty("TRAVEL_AGENCY")).toBe("NET");
    expect(tierForCounterparty("LAND_AGENCY")).toBe("NET");
  });
  it("그 외(SUPPLIER·UNKNOWN·IGNORED) → NET(방어)", () => {
    expect(tierForCounterparty("SUPPLIER")).toBe("NET");
    expect(tierForCounterparty("UNKNOWN")).toBe("NET");
    expect(tierForCounterparty("IGNORED")).toBe("NET");
  });
});

describe("pickLowestSupplierCost — 시즌 우선-else-base 원가 >0 최저값 (계약 A)", () => {
  const c = (vnd: bigint, isBase = false) => ({ isBase, supplierCostVnd: vnd });

  it("시즌 중 최소, base=0 제외", () => {
    expect(pickLowestSupplierCost([c(0n, true), c(3_000_000n), c(2_000_000n)])).toBe(2_000_000n);
  });
  it("★base가 원가와 같아도 시즌가 있으면 시즌 최저 — base 폴백 아님", () => {
    // base 10M(=원가) + 시즌 11~12.5M → 시즌 최저 11M
    expect(pickLowestSupplierCost([c(10_000_000n, true), c(12_500_000n), c(11_000_000n)])).toBe(11_000_000n);
  });
  it("시즌 없으면 base로 폴백", () => {
    expect(pickLowestSupplierCost([c(10_000_000n, true)])).toBe(10_000_000n);
  });
  it("전부 0/빈 배열이면 null", () => {
    expect(pickLowestSupplierCost([c(0n, true)])).toBeNull();
    expect(pickLowestSupplierCost([])).toBeNull();
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

describe("suggestSalePriceUsd — VND→USD 환산 제안 (후속확장 3, float 금지)", () => {
  it("1 USD = 26,000 VND일 때 2,400,000₫ → $92(반올림)", () => {
    // 2,400,000 / 26,000 = 92.307… → 92
    expect(suggestSalePriceUsd(2_400_000n, "26000")).toBe(92);
  });
  it("suggestSalePriceKrw와 동일 코어(같은 환율·금액이면 같은 결과)", () => {
    expect(suggestSalePriceUsd(1_000_000n, "25400.3333")).toBe(
      suggestSalePriceKrw(1_000_000n, "25400.3333")
    );
    expect(suggestSalePriceUsd(38_100_000n, "25400")).toBe(1_500); // usdToVndSnapshot 역방향
  });
  it("잘못된 환율 형식·0 이하 거부", () => {
    expect(() => suggestSalePriceUsd(1n, "abc")).toThrow(RangeError);
    expect(() => suggestSalePriceUsd(1n, "25400.55555")).toThrow(RangeError);
    expect(() => suggestSalePriceUsd(1n, "0")).toThrow(RangeError);
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
    // ADR-0042: 엔진이 villa.premiumDays·holidayDate를 로드(프리미엄 없는 기본 목)
    villa: { findUnique: async () => ({ premiumDays: [] }) },
    villaRatePeriod: {
      findFirst: async () => baseRow,
      // 라우트 where(startDate<lt,endDate>gt)는 목에서 무시 — 전부 반환하고 resolveRatePeriod가 날짜 판정
      findMany: async () => periodRows,
    },
    holidayDate: { findMany: async () => [] },
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

// ===================== ADR-0031 소비자 직판가 2단계 =====================

describe("computeConsumerSalePriceVnd — 소비자가 = Net + 마진", () => {
  it("PERCENT: Net 2,000,000 + 25% = 2,500,000", () => {
    expect(computeConsumerSalePriceVnd(2_000_000n, MarginType.PERCENT, 25n)).toBe(2_500_000n);
  });
  it("FIXED_VND: Net 2,000,000 + 300,000 = 2,300,000", () => {
    expect(computeConsumerSalePriceVnd(2_000_000n, MarginType.FIXED_VND, 300_000n)).toBe(2_300_000n);
  });
  it("마진 0 → Net 그대로", () => {
    expect(computeConsumerSalePriceVnd(2_000_000n, MarginType.PERCENT, 0n)).toBe(2_000_000n);
  });
  it("음수 거부", () => {
    expect(() => computeConsumerSalePriceVnd(-1n, MarginType.PERCENT, 10n)).toThrow(RangeError);
  });
});

describe("priceTierForChannel — 채널 → 가격 계층", () => {
  it("DIRECT → CONSUMER", () => {
    expect(priceTierForChannel(BookingChannel.DIRECT)).toBe("CONSUMER");
  });
  it("여행사·랜드사 → NET", () => {
    expect(priceTierForChannel(BookingChannel.TRAVEL_AGENCY)).toBe("NET");
    expect(priceTierForChannel(BookingChannel.LAND_AGENCY)).toBe("NET");
  });
});

/** Net·소비자 판매가를 모두 가진 base 1행 목 (ADR-0031 계층 견적용) */
function makeTierDb(row: {
  salePriceVnd: bigint;
  salePriceKrw: number;
  consumerSalePriceVnd: bigint | null;
  consumerSalePriceKrw: number | null;
}): DbClient {
  const baseRow = {
    season: SeasonType.LOW,
    isBase: true,
    startDate: null,
    endDate: null,
    supplierCostVnd: 1_000_000n,
    ...row,
  };
  return {
    villa: { findUnique: async () => ({ premiumDays: [] }) },
    villaRatePeriod: {
      findFirst: async () => baseRow,
      findMany: async () => [],
    },
    holidayDate: { findMany: async () => [] },
  } as unknown as DbClient;
}

describe("quoteStayForVilla — 채널별 가격 계층 (ADR-0031)", () => {
  const row = {
    salePriceVnd: 2_000_000n,
    salePriceKrw: 110_000,
    consumerSalePriceVnd: 2_500_000n,
    consumerSalePriceKrw: 140_000,
  };
  const range = { checkIn: d("2026-07-01"), checkOut: d("2026-07-03") }; // 2박

  it("DIRECT + VND → 소비자가 합산", async () => {
    const q = await quoteStayForVilla(makeTierDb(row), "v1", range, Currency.VND, BookingChannel.DIRECT);
    expect(q.totalSaleVnd).toBe(5_000_000n); // 2,500,000 × 2
  });
  it("DIRECT + KRW → 소비자가 합산", async () => {
    const q = await quoteStayForVilla(makeTierDb(row), "v1", range, Currency.KRW, BookingChannel.DIRECT);
    expect(q.totalSaleKrw).toBe(280_000); // 140,000 × 2
  });
  it("여행사 + VND → Net 합산", async () => {
    const q = await quoteStayForVilla(makeTierDb(row), "v1", range, Currency.VND, BookingChannel.TRAVEL_AGENCY);
    expect(q.totalSaleVnd).toBe(4_000_000n); // 2,000,000 × 2
  });
  it("채널 미지정 → Net(하위호환)", async () => {
    const q = await quoteStayForVilla(makeTierDb(row), "v1", range, Currency.VND);
    expect(q.totalSaleVnd).toBe(4_000_000n);
  });
  it("소비자가 null → Net 폴백 (DIRECT라도)", async () => {
    const nullRow = { ...row, consumerSalePriceVnd: null, consumerSalePriceKrw: null };
    const qVnd = await quoteStayForVilla(makeTierDb(nullRow), "v1", range, Currency.VND, BookingChannel.DIRECT);
    expect(qVnd.totalSaleVnd).toBe(4_000_000n); // Net 폴백
    const qKrw = await quoteStayForVilla(makeTierDb(nullRow), "v1", range, Currency.KRW, BookingChannel.DIRECT);
    expect(qKrw.totalSaleKrw).toBe(220_000); // Net 폴백
  });

  // ADR-0031 안전장치 — 폴백 발생 사실을 상위(제안 생성 경고)로 흘려보내는 신호
  it("소비자가 null → consumerFallbackNights로 폴백 박 수 노출 (박별 플래그 포함)", async () => {
    const nullRow = { ...row, consumerSalePriceVnd: null, consumerSalePriceKrw: null };
    const qKrw = await quoteStayForVilla(makeTierDb(nullRow), "v1", range, Currency.KRW, BookingChannel.DIRECT);
    expect(qKrw.consumerFallbackNights).toBe(2); // 2박 모두 폴백
    expect(qKrw.nightly.every((n) => n.consumerFallback === true)).toBe(true);
  });
  it("소비자가 설정됨 → 폴백 신호 없음(consumerFallbackNights 미포함)", async () => {
    const qKrw = await quoteStayForVilla(makeTierDb(row), "v1", range, Currency.KRW, BookingChannel.DIRECT);
    expect(qKrw.consumerFallbackNights).toBeUndefined();
    expect(qKrw.nightly.some((n) => n.consumerFallback)).toBe(false);
  });
  it("NET 계층(여행사)은 소비자가 null이어도 폴백 신호 안 냄", async () => {
    const nullRow = { ...row, consumerSalePriceVnd: null, consumerSalePriceKrw: null };
    const q = await quoteStayForVilla(makeTierDb(nullRow), "v1", range, Currency.VND, BookingChannel.TRAVEL_AGENCY);
    expect(q.consumerFallbackNights).toBeUndefined();
  });
  it("원가는 계층 무관 동일", async () => {
    const qDirect = await quoteStayForVilla(makeTierDb(row), "v1", range, Currency.VND, BookingChannel.DIRECT);
    const qAgency = await quoteStayForVilla(makeTierDb(row), "v1", range, Currency.VND, BookingChannel.TRAVEL_AGENCY);
    expect(qDirect.totalSupplierCostVnd).toBe(2_000_000n);
    expect(qAgency.totalSupplierCostVnd).toBe(2_000_000n);
  });
});
