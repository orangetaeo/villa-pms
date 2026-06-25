import { describe, expect, it } from "vitest";
import { Currency } from "@prisma/client";
import {
  computeVndEquivalent,
  summarizeCollection,
  type PaymentLike,
} from "@/lib/payment";

describe("computeVndEquivalent — 수납액 VND 환산", () => {
  it("VND 수납은 그대로(환율 무시)", () => {
    expect(computeVndEquivalent(Currency.VND, 5_000_000n, null)).toBe(5_000_000n);
    expect(computeVndEquivalent(Currency.VND, 0n, "18.5")).toBe(0n);
  });

  it("KRW 수납은 환율로 half-up 환산", () => {
    // 1,000,000원 × 18.5 = 18,500,000동
    expect(computeVndEquivalent(Currency.KRW, 1_000_000n, "18.5")).toBe(18_500_000n);
  });

  it("KRW half-up 경계 — 0.5는 올림", () => {
    // 1원 × 18.5001 = 18.5001동 → half-up 19? scaled=185001, (1*185001+5000)/10000 = 190001/10000 = 19
    expect(computeVndEquivalent(Currency.KRW, 1n, "18.5001")).toBe(19n);
    // 1원 × 18.4999 = 184999+5000=189999/10000 = 18
    expect(computeVndEquivalent(Currency.KRW, 1n, "18.4999")).toBe(18n);
  });

  it("KRW인데 환율 없으면 throw (허위 0 금지)", () => {
    expect(() => computeVndEquivalent(Currency.KRW, 1_000_000n, null)).toThrow(/환율/);
  });

  it("음수 금액 throw", () => {
    expect(() => computeVndEquivalent(Currency.VND, -1n, null)).toThrow(/음수/);
  });

  it("잘못된 환율 형식 throw", () => {
    expect(() => computeVndEquivalent(Currency.KRW, 1n, "18.55555")).toThrow(/환율 형식/);
    expect(() => computeVndEquivalent(Currency.KRW, 1n, "0")).toThrow(/0보다/);
  });
});

const vnd = (amount: bigint): PaymentLike => ({
  currency: Currency.VND,
  amount,
  vndEquivalent: amount,
});
const krw = (amount: bigint, vndEq: bigint): PaymentLike => ({
  currency: Currency.KRW,
  amount,
  vndEquivalent: vndEq,
});

describe("summarizeCollection — 견적 대비 실수납 요약", () => {
  it("수납 없음 → UNPAID, 미수=견적 전액", () => {
    const s = summarizeCollection([], 10_000_000n);
    expect(s.status).toBe("UNPAID");
    expect(s.collectedVndEquivalent).toBe(0n);
    expect(s.outstandingVnd).toBe(10_000_000n);
    expect(s.paymentCount).toBe(0);
  });

  it("부분 입금 누적 → PARTIAL, 미수 잔액", () => {
    const s = summarizeCollection([vnd(3_000_000n), vnd(2_000_000n)], 10_000_000n);
    expect(s.status).toBe("PARTIAL");
    expect(s.collectedVndEquivalent).toBe(5_000_000n);
    expect(s.outstandingVnd).toBe(5_000_000n);
  });

  it("정확히 완납 → PAID, 미수 0", () => {
    const s = summarizeCollection([vnd(10_000_000n)], 10_000_000n);
    expect(s.status).toBe("PAID");
    expect(s.outstandingVnd).toBe(0n);
  });

  it("초과 입금 → OVERPAID, 미수 음수", () => {
    const s = summarizeCollection([vnd(11_000_000n)], 10_000_000n);
    expect(s.status).toBe("OVERPAID");
    expect(s.outstandingVnd).toBe(-1_000_000n);
  });

  it("혼합 통화 — vndEquivalent 합산 + 통화별 원금 집계", () => {
    // KRW 500,000원(=9,250,000동 환산) + VND 750,000동
    const s = summarizeCollection(
      [krw(500_000n, 9_250_000n), vnd(750_000n)],
      10_000_000n
    );
    expect(s.collectedVndEquivalent).toBe(10_000_000n);
    expect(s.status).toBe("PAID");
    expect(s.collectedByCurrency[Currency.KRW]).toBe(500_000n);
    expect(s.collectedByCurrency[Currency.VND]).toBe(750_000n);
  });

  it("저장된 vndEquivalent 없으면 통화·환율로 즉석 계산", () => {
    const p: PaymentLike = {
      currency: Currency.KRW,
      amount: 1_000_000n,
      vndEquivalent: null,
      fxRateToVnd: "18.5",
    };
    const s = summarizeCollection([p], 18_500_000n);
    expect(s.collectedVndEquivalent).toBe(18_500_000n);
    expect(s.status).toBe("PAID");
  });
});
