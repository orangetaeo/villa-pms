import { describe, expect, it } from "vitest";
import { Currency } from "@prisma/client";
import {
  bookingFinance,
  summarizeFinance,
  type FinanceBooking,
} from "./settlement-finance";

// settlement-finance의 KRW/VND 동작은 statistics.test.ts(summarizeFinance 위임)에서 검증됨.
// 이 파일은 Phase 2 USD 분기(bookingFinance·summarizeFinance)를 집중 검증한다.

describe("bookingFinance — USD 분기 (Phase 2)", () => {
  const usdBase: FinanceBooking = {
    saleCurrency: Currency.USD,
    totalSaleKrw: null,
    totalSaleVnd: null,
    totalSaleUsd: 1_500,
    supplierCostVnd: 20_000_000n,
    fxVndPerKrw: null,
    fxVndPerUsd: "25400",
  };

  it("USD + 환율(25400) → 환산=38,100,000, marginVnd=환산−지급, collectedUsd 원본", () => {
    const f = bookingFinance(usdBase);
    expect(f.collectedUsd).toBe(1_500);
    expect(f.collectedKrw).toBe(0);
    expect(f.collectedVnd).toBe(0n);
    expect(f.collectedVndEquivalent).toBe(38_100_000n); // 1500 × 25400
    expect(f.payoutVnd).toBe(20_000_000n);
    expect(f.marginVnd).toBe(18_100_000n);
    expect(f.fxMissing).toBe(false);
  });

  it("USD인데 fxVndPerUsd 스냅샷 없음 → 환산·마진 null, fxMissing=true, collectedUsd 보존", () => {
    const f = bookingFinance({ ...usdBase, fxVndPerUsd: null });
    expect(f.collectedUsd).toBe(1_500);
    expect(f.collectedVndEquivalent).toBeNull();
    expect(f.marginVnd).toBeNull();
    expect(f.fxMissing).toBe(true);
  });

  it("음수 마진(원가 > 환산 매출)도 그대로 계산", () => {
    const f = bookingFinance({ ...usdBase, totalSaleUsd: 100, supplierCostVnd: 5_000_000n });
    expect(f.collectedVndEquivalent).toBe(2_540_000n); // 100 × 25400
    expect(f.marginVnd).toBe(-2_460_000n);
  });

  it("지원 통화 게이트: USD는 허용(throw 안 함), 미지원 통화는 throw", () => {
    expect(() => bookingFinance(usdBase)).not.toThrow();
    expect(() =>
      bookingFinance({ ...usdBase, saleCurrency: "RUB" as Currency })
    ).toThrow(RangeError);
  });
});

describe("summarizeFinance — USD 혼합 합산 (통화 분리·환산 후 마진)", () => {
  it("KRW·VND·USD 혼합: 원본 통화 분리 + 환산 후 마진 합", () => {
    const rows: FinanceBooking[] = [
      // VND 예약
      {
        saleCurrency: Currency.VND,
        totalSaleKrw: null,
        totalSaleVnd: 10_000_000n,
        totalSaleUsd: null,
        supplierCostVnd: 6_000_000n,
        fxVndPerKrw: null,
        fxVndPerUsd: null,
      },
      // USD 예약(환율 있음)
      {
        saleCurrency: Currency.USD,
        totalSaleKrw: null,
        totalSaleVnd: null,
        totalSaleUsd: 1_000,
        supplierCostVnd: 20_000_000n,
        fxVndPerKrw: null,
        fxVndPerUsd: "25400",
      },
      // USD 예약(환율 없음 → fxMissing, 합계 제외)
      {
        saleCurrency: Currency.USD,
        totalSaleKrw: null,
        totalSaleVnd: null,
        totalSaleUsd: 500,
        supplierCostVnd: 8_000_000n,
        fxVndPerKrw: null,
        fxVndPerUsd: null,
      },
    ];
    const s = summarizeFinance(rows);
    expect(s.collectedVnd).toBe(10_000_000n); // VND 원본만
    expect(s.collectedUsd).toBe(1_500); // USD 원본 합(1000+500)
    expect(s.collectedKrw).toBe(0);
    // 환산 가능 분만: VND 10,000,000 + USD 25,400,000 = 35,400,000
    expect(s.collectedVndEquivalent).toBe(35_400_000n);
    // 마진: (10,000,000-6,000,000) + (25,400,000-20,000,000) = 4,000,000 + 5,400,000
    expect(s.marginVnd).toBe(9_400_000n);
    expect(s.fxMissingCount).toBe(1);
    expect(s.bookingCount).toBe(3);
  });
});
