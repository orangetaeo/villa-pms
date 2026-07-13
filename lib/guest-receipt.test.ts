import { describe, expect, it } from "vitest";
import { deriveDepositSettlement } from "./guest-receipt";

// 보증금 파생 계산 — 상계/파손 분리·환불 음수 방지·구 데이터 폴백 (T-guest-settlement-receipt)
describe("deriveDepositSettlement — 보증금 가감산 파생", () => {
  it("상계 + 파손 혼합 — deductionVnd(총액)에서 상계를 빼면 파손 차감", () => {
    // 보증금 100만₫ 수취, 총 80만₫ 차감(상계 30만 + 파손 50만) → 환불 20만
    const r = deriveDepositSettlement({
      depositAmount: 1_000_000,
      deductionVnd: 800_000n,
      depositCurrency: "VND" as const,
      depositOffset: 300_000n,
    });
    expect(r.offsetAmount).toBe(300_000n);
    expect(r.damageDeductVnd).toBe(500_000n);
    expect(r.totalDeductVnd).toBe(800_000n);
    expect(r.refundAmount).toBe(200_000);
  });

  it("파손만(상계 0) — 구 데이터/상계 없는 경우 파손=차감총액", () => {
    const r = deriveDepositSettlement({
      depositAmount: 1_000_000,
      deductionVnd: 500_000n,
      depositCurrency: "VND" as const,
      depositOffset: 0n,
    });
    expect(r.offsetAmount).toBe(0n);
    expect(r.damageDeductVnd).toBe(500_000n);
    expect(r.totalDeductVnd).toBe(500_000n);
    expect(r.refundAmount).toBe(500_000);
  });

  it("상계만(파손 0) — 차감총액=상계면 파손 차감 0", () => {
    const r = deriveDepositSettlement({
      depositAmount: 1_000_000,
      deductionVnd: 300_000n,
      depositCurrency: "VND" as const,
      depositOffset: 300_000n,
    });
    expect(r.damageDeductVnd).toBe(0n);
    expect(r.refundAmount).toBe(700_000);
  });

  it("차감 없음(deductionVnd null) — 전액 환불", () => {
    const r = deriveDepositSettlement({
      depositAmount: 1_000_000,
      deductionVnd: null,
      depositCurrency: "VND" as const,
      depositOffset: 0n,
    });
    expect(r.totalDeductVnd).toBe(0n);
    expect(r.damageDeductVnd).toBe(0n);
    expect(r.refundAmount).toBe(1_000_000);
  });

  it("환불 음수 방지 — 차감총액이 보증금 초과면 환불 0", () => {
    const r = deriveDepositSettlement({
      depositAmount: 300_000,
      deductionVnd: 500_000n,
      depositCurrency: "VND" as const,
      depositOffset: 0n,
    });
    expect(r.refundAmount).toBe(0);
  });

  it("파손 음수 방지 — 상계가 총액 초과(비정상)여도 파손 차감은 0으로 클램프", () => {
    const r = deriveDepositSettlement({
      depositAmount: 1_000_000,
      deductionVnd: 300_000n,
      depositCurrency: "VND" as const,
      depositOffset: 400_000n,
    });
    expect(r.damageDeductVnd).toBe(0n);
  });

  it("상계 음수 가드 — 0으로 클램프", () => {
    const r = deriveDepositSettlement({
      depositAmount: 1_000_000,
      deductionVnd: 200_000n,
      depositCurrency: "VND" as const,
      depositOffset: -100_000n,
    });
    expect(r.offsetAmount).toBe(0n);
    expect(r.damageDeductVnd).toBe(200_000n);
  });

  it("deductionVnd 음수/0 방어 — 총액 0으로 처리", () => {
    const r = deriveDepositSettlement({
      depositAmount: 500_000,
      deductionVnd: -10n,
      depositCurrency: "VND" as const,
      depositOffset: 0n,
    });
    expect(r.totalDeductVnd).toBe(0n);
    expect(r.refundAmount).toBe(500_000);
  });

  it("보증금 없음(depositAmount null) — 환불액 null", () => {
    const r = deriveDepositSettlement({
      depositAmount: null,
      deductionVnd: 100_000n,
      depositCurrency: "VND" as const,
      depositOffset: 0n,
    });
    expect(r.refundAmount).toBeNull();
    expect(r.totalDeductVnd).toBe(100_000n);
  });

  // ── 비VND 보증금 상계 (T-checkout-single-approve-deposit-currency, 2026-07-13) ──
  it("KRW 보증금 전액 상계 — 상계=₩ 단위·환불 0", () => {
    const r = deriveDepositSettlement({
      depositAmount: 200_000,
      depositCurrency: "KRW" as const,
      deductionVnd: null, // 비VND 상계는 deductionVnd에 미합산(checkout.ts)
      depositOffset: 200_000n,
    });
    expect(r.offsetAmount).toBe(200_000n);
    expect(r.damageDeductVnd).toBe(0n);
    expect(r.refundAmount).toBe(0);
  });

  it("KRW 보증금 일부 상계 — 환불 = amount − 상계(₩)", () => {
    const r = deriveDepositSettlement({
      depositAmount: 200_000,
      depositCurrency: "KRW" as const,
      deductionVnd: null,
      depositOffset: 150_000n,
    });
    expect(r.refundAmount).toBe(50_000);
  });

  it("KRW 보증금 + 파손(₫) — 파손은 전액 표시·보증금 환불에는 미반영(계약 한계)", () => {
    const r = deriveDepositSettlement({
      depositAmount: 200_000,
      depositCurrency: "KRW" as const,
      deductionVnd: 500_000n, // 파손 ₫500,000 (VND 기록)
      depositOffset: 100_000n,
    });
    expect(r.damageDeductVnd).toBe(500_000n); // 상계 차감 없이 전부 파손
    expect(r.refundAmount).toBe(100_000); // amount − 상계(₩)만
  });
});
