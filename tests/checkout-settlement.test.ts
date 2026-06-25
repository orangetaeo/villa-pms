import { describe, it, expect } from "vitest";
import {
  computeGuestBill,
  isGuestSettlementMethod,
} from "@/lib/checkout-settlement";

describe("computeGuestBill", () => {
  it("미니바만 — VND 합계, KRW 0", () => {
    const b = computeGuestBill(70_000n, []);
    expect(b.minibarVnd).toBe(70_000n);
    expect(b.totalVnd).toBe(70_000n);
    expect(b.totalKrw).toBe(0);
  });

  it("미니바 null이면 0으로 시작", () => {
    const b = computeGuestBill(null, [{ priceKrw: 1_800_000, priceVnd: null }]);
    expect(b.minibarVnd).toBe(0n);
    expect(b.totalKrw).toBe(1_800_000);
    expect(b.totalVnd).toBe(0n);
  });

  it("통화별 분리 — VND/KRW 합산 금지", () => {
    const b = computeGuestBill(50_000n, [
      { priceKrw: null, priceVnd: 1_650_000n }, // VND 옵션
      { priceKrw: 600_000, priceVnd: null }, // KRW 옵션
      { priceKrw: 0, priceVnd: 300_000n }, // KRW 0은 무시, VND만
    ]);
    expect(b.serviceVnd).toBe(1_950_000n); // 1,650,000 + 300,000
    expect(b.serviceKrw).toBe(600_000);
    expect(b.totalVnd).toBe(2_000_000n); // 미니바 50,000 + 옵션 VND 1,950,000
    expect(b.totalKrw).toBe(600_000);
  });

  it("빈 청구 — 모두 0", () => {
    const b = computeGuestBill(null, []);
    expect(b.totalVnd).toBe(0n);
    expect(b.totalKrw).toBe(0);
  });
});

describe("isGuestSettlementMethod", () => {
  it("허용값만 통과", () => {
    expect(isGuestSettlementMethod("CASH")).toBe(true);
    expect(isGuestSettlementMethod("BANK_TRANSFER")).toBe(true);
    expect(isGuestSettlementMethod("OTHER")).toBe(true);
    expect(isGuestSettlementMethod("CARD")).toBe(false);
  });
});
