import { describe, expect, it } from "vitest";
import { Currency } from "@prisma/client";
import { krwToVndSnapshot } from "@/lib/pricing";
import {
  bookingFinance,
  summarizeFinance,
  type FinanceBooking,
} from "@/lib/settlement-finance";

// 정산 고도화 1차 — KRW→VND 환산·예약별 손익·월 합계·환율 미상 제외 검증 (BigInt·half-up).

describe("krwToVndSnapshot — KRW→VND 스냅샷 환산 (half-up)", () => {
  it("1 KRW = 18.87 VND → 1,000,000원 = 18,870,000₫", () => {
    expect(krwToVndSnapshot(1_000_000, "18.8700")).toBe(18_870_000n);
  });
  it("half-up 반올림 (.5 올림)", () => {
    // krw=1, fx=0.5 → 0.5 → half-up 1
    expect(krwToVndSnapshot(1, "0.5000")).toBe(1n);
    // krw=1, fx=0.4999 → 0.4999 → 0
    expect(krwToVndSnapshot(1, "0.4999")).toBe(0n);
  });
  it("suggestSalePriceKrw 역방향 정합 (근사 왕복)", () => {
    expect(krwToVndSnapshot(1000, "20.0000")).toBe(20_000n);
  });
  it("음수·잘못된 환율·소수 KRW는 throw", () => {
    expect(() => krwToVndSnapshot(-1, "18.87")).toThrow();
    expect(() => krwToVndSnapshot(1.5, "18.87")).toThrow();
    expect(() => krwToVndSnapshot(1000, "abc")).toThrow();
    expect(() => krwToVndSnapshot(1000, "0")).toThrow();
  });
});

const krwBooking = (krw: number, cost: bigint, fx: string | null): FinanceBooking => ({
  saleCurrency: Currency.KRW,
  totalSaleKrw: krw,
  totalSaleVnd: null,
  supplierCostVnd: cost,
  fxVndPerKrw: fx,
});
const vndBooking = (vnd: bigint, cost: bigint): FinanceBooking => ({
  saleCurrency: Currency.VND,
  totalSaleKrw: null,
  totalSaleVnd: vnd,
  supplierCostVnd: cost,
  fxVndPerKrw: null,
});

describe("bookingFinance — 예약별 손익", () => {
  it("VND 예약: 마진 = 수납 − 지급", () => {
    const f = bookingFinance(vndBooking(30_000_000n, 20_000_000n));
    expect(f.collectedVnd).toBe(30_000_000n);
    expect(f.collectedVndEquivalent).toBe(30_000_000n);
    expect(f.payoutVnd).toBe(20_000_000n);
    expect(f.marginVnd).toBe(10_000_000n);
    expect(f.fxMissing).toBe(false);
  });
  it("KRW 예약 + 환율 스냅샷: VND 환산 후 마진", () => {
    const f = bookingFinance(krwBooking(2_000_000, 30_000_000n, "18.8700"));
    expect(f.collectedKrw).toBe(2_000_000);
    expect(f.collectedVndEquivalent).toBe(37_740_000n); // 2,000,000 × 18.87
    expect(f.marginVnd).toBe(7_740_000n);
    expect(f.fxMissing).toBe(false);
  });
  it("KRW 예약 + 환율 미상: 환산·마진 null, fxMissing", () => {
    const f = bookingFinance(krwBooking(2_000_000, 30_000_000n, null));
    expect(f.collectedKrw).toBe(2_000_000);
    expect(f.collectedVndEquivalent).toBeNull();
    expect(f.marginVnd).toBeNull();
    expect(f.fxMissing).toBe(true);
  });
  it("미지원 통화는 throw (화이트리스트)", () => {
    expect(() =>
      bookingFinance({
        saleCurrency: "USD" as Currency,
        totalSaleKrw: null,
        totalSaleVnd: null,
        supplierCostVnd: 0n,
        fxVndPerKrw: null,
      })
    ).toThrow();
  });
});

describe("summarizeFinance — 월/공급자 합계", () => {
  it("KRW+VND 혼합 합산, 환율 미상은 환산·마진 제외하되 수납KRW·지급은 포함", () => {
    const s = summarizeFinance([
      vndBooking(30_000_000n, 20_000_000n), // margin +10M
      krwBooking(2_000_000, 30_000_000n, "18.8700"), // equiv 37.74M, margin +7.74M
      krwBooking(1_000_000, 15_000_000n, null), // fx 미상 — 환산·마진 제외, 지급 15M·수납KRW 1M만
    ]);
    expect(s.bookingCount).toBe(3);
    expect(s.collectedKrw).toBe(3_000_000); // 2M + 1M
    expect(s.collectedVnd).toBe(30_000_000n);
    expect(s.collectedVndEquivalent).toBe(67_740_000n); // 30M + 37.74M (미상 제외)
    expect(s.payoutVnd).toBe(65_000_000n); // 20M + 30M + 15M (전부 포함)
    expect(s.marginVnd).toBe(17_740_000n); // 10M + 7.74M (미상 제외)
    expect(s.fxMissingCount).toBe(1);
  });
  it("빈 목록은 0", () => {
    const s = summarizeFinance([]);
    expect(s).toMatchObject({
      collectedKrw: 0,
      collectedVnd: 0n,
      collectedVndEquivalent: 0n,
      payoutVnd: 0n,
      marginVnd: 0n,
      fxMissingCount: 0,
      bookingCount: 0,
    });
  });
  it("마진 음수(역마진)도 정확히 합산", () => {
    const s = summarizeFinance([vndBooking(10_000_000n, 12_000_000n)]); // -2M
    expect(s.marginVnd).toBe(-2_000_000n);
  });
});
