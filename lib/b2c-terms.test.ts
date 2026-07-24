import { describe, it, expect } from "vitest";
import {
  B2C_PAYMENT_TERMS,
  B2C_TERMS_VERSION,
  computeB2cDisplaySplit,
} from "./b2c-terms";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("B2C_PAYMENT_TERMS — 지원 5언어 완비", () => {
  it("ko/vi/en/zh/ru 5개 언어, 각 필드 채워짐(일본어 제외)", () => {
    const langs = Object.keys(B2C_PAYMENT_TERMS).sort();
    expect(langs).toEqual(["en", "ko", "ru", "vi", "zh"]);
    for (const t of Object.values(B2C_PAYMENT_TERMS)) {
      expect(t.paymentLines.length).toBeGreaterThanOrEqual(3);
      expect(t.fxDisclosure.length).toBeGreaterThan(10);
      expect(t.cancelNote.length).toBeGreaterThan(10);
    }
  });
  it("버전 상수 노출", () => {
    expect(B2C_TERMS_VERSION).toBe(1);
  });
});

describe("computeB2cDisplaySplit — 청구통화 분할(표시)", () => {
  const opts = { now: d("2026-08-01"), depositRatePct: 50, balanceLeadDays: 14 };

  it("KRW 100만원, 체크인 넉넉 → 계약금 50만 + 잔금 약 50만(합=총액)", () => {
    const s = computeB2cDisplaySplit(1_000_000n, { ...opts, checkIn: d("2026-10-01") });
    expect(s.fullPrepay).toBe(false);
    expect(s.deposit).toBe(500_000n);
    expect(s.balanceApprox).toBe(500_000n);
    expect(s.deposit + s.balanceApprox).toBe(1_000_000n);
  });

  it("홀수 총액 → 계약금 올림, 합계 정확 보존", () => {
    const s = computeB2cDisplaySplit(1_000_001n, { ...opts, checkIn: d("2026-10-01") });
    expect(s.deposit).toBe(500_001n);
    expect(s.balanceApprox).toBe(500_000n);
    expect(s.deposit + s.balanceApprox).toBe(1_000_001n);
  });

  it("체크인 14일 이내 → 전액 선결제(계약금=총액, 잔금 0)", () => {
    const s = computeB2cDisplaySplit(1_000_000n, { ...opts, checkIn: d("2026-08-10") });
    expect(s.fullPrepay).toBe(true);
    expect(s.deposit).toBe(1_000_000n);
    expect(s.balanceApprox).toBe(0n);
  });

  it("0·음수 총액 → 0 분할", () => {
    const s = computeB2cDisplaySplit(0n, { ...opts, checkIn: d("2026-10-01") });
    expect(s.deposit).toBe(0n);
    expect(s.balanceApprox).toBe(0n);
  });
});
