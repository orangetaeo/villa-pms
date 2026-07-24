import { describe, it, expect } from "vitest";
import { Currency } from "@prisma/client";
import { resolveRefundPct, computeB2cRefund, type B2cPaidRecord } from "./b2c-refund";

const TIERS = [
  { fromDays: 30, refundPct: 100 },
  { fromDays: 14, refundPct: 50 },
  { fromDays: -1, refundPct: 0 },
];

describe("resolveRefundPct — 잔여일 → 환불율", () => {
  it("D-40 → 100%", () => expect(resolveRefundPct(TIERS, 40)).toBe(100));
  it("D-30 경계 → 100%", () => expect(resolveRefundPct(TIERS, 30)).toBe(100));
  it("D-20 → 50%", () => expect(resolveRefundPct(TIERS, 20)).toBe(50));
  it("D-14 경계 → 50%", () => expect(resolveRefundPct(TIERS, 14)).toBe(50));
  it("D-5 → 0%", () => expect(resolveRefundPct(TIERS, 5)).toBe(0));
  it("노쇼(-1) → 0%", () => expect(resolveRefundPct(TIERS, -1)).toBe(0));
});

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// 총액 1,000,000동. 계약금 50만(구), 잔금 50만(신)
const deposit: B2cPaidRecord = { paymentId: "dep", currency: Currency.VND, amount: 500_000n, vndEquivalent: 500_000n, receivedAt: d("2026-08-01") };
const balance: B2cPaidRecord = { paymentId: "bal", currency: Currency.VND, amount: 500_000n, vndEquivalent: 500_000n, receivedAt: d("2026-08-20") };

describe("computeB2cRefund — 위약금·환불 공식(테오 확정)", () => {
  it("계약금만 + 100% 환불 → 위약금 0, 계약금 전액 반환", () => {
    const r = computeB2cRefund(1_000_000n, 100, [deposit]);
    expect(r.penaltyVnd).toBe(0n);
    expect(r.refundableVnd).toBe(500_000n);
    expect(r.lines).toEqual([{ paymentId: "dep", currency: Currency.VND, refundAmount: 500_000n, refundVndEquivalent: 500_000n }]);
  });

  it("계약금만 + 50% 환불 → 위약금 50만 ≥ 계약금 → 환불 0", () => {
    const r = computeB2cRefund(1_000_000n, 50, [deposit]);
    expect(r.penaltyVnd).toBe(500_000n);
    expect(r.refundableVnd).toBe(0n);
    expect(r.lines).toEqual([]);
  });

  it("완납 + 50% 환불 → 위약금 50만, 환불 50만(잔금부터 LIFO)", () => {
    const r = computeB2cRefund(1_000_000n, 50, [deposit, balance]);
    expect(r.penaltyVnd).toBe(500_000n);
    expect(r.refundableVnd).toBe(500_000n);
    // 최신(잔금)부터 전액 환불 → 잔금 1건
    expect(r.lines).toEqual([{ paymentId: "bal", currency: Currency.VND, refundAmount: 500_000n, refundVndEquivalent: 500_000n }]);
  });

  it("완납 + 100% 환불 → 위약금 0, 전액 환불(잔금+계약금)", () => {
    const r = computeB2cRefund(1_000_000n, 100, [deposit, balance]);
    expect(r.refundableVnd).toBe(1_000_000n);
    expect(r.lines.map((l) => l.paymentId).sort()).toEqual(["bal", "dep"]);
    expect(r.lines.reduce((s, l) => s + l.refundAmount, 0n)).toBe(1_000_000n);
  });

  it("완납 + 0% 환불(노쇼) → 전액 몰수", () => {
    const r = computeB2cRefund(1_000_000n, 0, [deposit, balance]);
    expect(r.penaltyVnd).toBe(1_000_000n);
    expect(r.refundableVnd).toBe(0n);
    expect(r.lines).toEqual([]);
  });

  it("부분 환불이 결제 경계를 걸치면 비례 부분환불(마지막 닿는 건)", () => {
    // 총 100만, 70% 환불 → 위약금 30만, 환불가능 70만. 잔금 50만 전액 + 계약금 20만 부분(비례).
    const r = computeB2cRefund(1_000_000n, 70, [deposit, balance]);
    expect(r.refundableVnd).toBe(700_000n);
    const bal = r.lines.find((l) => l.paymentId === "bal")!;
    const dep = r.lines.find((l) => l.paymentId === "dep")!;
    expect(bal.refundAmount).toBe(500_000n); // 잔금 전액
    expect(dep.refundVndEquivalent).toBe(200_000n); // 계약금 중 20만만
    expect(dep.refundAmount).toBe(200_000n); // VND라 비례=200,000
    expect(r.lines.reduce((s, l) => s + l.refundVndEquivalent, 0n)).toBe(700_000n);
  });

  it("KRW 결제 비례 부분환불 — 낸 금액 기준 floor", () => {
    // 계약금 KRW 300,000원(=VND 5,550,000, fx 18.5), 총 VND 11,100,000, 50% 환불.
    const depKrw: B2cPaidRecord = { paymentId: "dk", currency: Currency.KRW, amount: 300_000n, vndEquivalent: 5_550_000n, receivedAt: d("2026-08-01") };
    // 위약금 = 50% × 11,100,000 = 5,550,000. 낸 5,550,000 − 5,550,000 = 0 → 환불 0
    const r = computeB2cRefund(11_100_000n, 50, [depKrw]);
    expect(r.refundableVnd).toBe(0n);
  });
});
