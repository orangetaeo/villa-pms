import { describe, expect, it } from "vitest";
import {
  computeGuestBill,
  normalizeSettlementLines,
  type SettlementLineInput,
} from "./checkout-settlement";

// ===================== computeGuestBill (기존 순수층) =====================

describe("computeGuestBill — 통화별 게스트 청구 합산 (ADR-0003)", () => {
  it("미니바(VND) + 서비스(VND/KRW) 통화별 분리 합산", () => {
    const bill = computeGuestBill(70_000n, [
      { priceVnd: 30_000n, priceKrw: null },
      { priceVnd: null, priceKrw: 50_000 },
      { priceVnd: null, priceKrw: 0 }, // 0 KRW는 무시
    ]);
    expect(bill).toEqual({
      minibarVnd: 70_000n,
      serviceVnd: 30_000n,
      serviceKrw: 50_000,
      totalVnd: 100_000n,
      totalKrw: 50_000,
    });
  });

  it("미니바 null → 0n", () => {
    const bill = computeGuestBill(null, []);
    expect(bill.minibarVnd).toBe(0n);
    expect(bill.totalVnd).toBe(0n);
    expect(bill.totalKrw).toBe(0);
  });
});

// ===================== normalizeSettlementLines (혼합 수납) =====================

describe("normalizeSettlementLines — 수납 라인 검증·병합·집계 (T-checkout-mixed)", () => {
  it("빈 배열 → lines=[]·전부 null·depositOffsetVnd=0n·derivedMethod=null", () => {
    expect(normalizeSettlementLines([])).toEqual({
      lines: [],
      settledVnd: null,
      settledKrw: null,
      settledUsd: null,
      depositOffsetVnd: 0n,
      derivedMethod: null,
    });
  });

  it("혼합 수단(현금 VND + 이체 KRW) → derivedMethod=MIXED + 통화별 합계", () => {
    const lines: SettlementLineInput[] = [
      { method: "CASH", currency: "VND", amount: 5_000_000n },
      { method: "BANK_TRANSFER", currency: "KRW", amount: 200_000n },
    ];
    const r = normalizeSettlementLines(lines);
    expect(r.derivedMethod).toBe("MIXED");
    expect(r.settledVnd).toBe(5_000_000n);
    expect(r.settledKrw).toBe(200_000);
    expect(r.settledUsd).toBeNull();
    expect(r.lines).toHaveLength(2);
  });

  it("단일 수단(여러 통화) → derivedMethod=그 수단", () => {
    const r = normalizeSettlementLines([
      { method: "CASH", currency: "VND", amount: 3_000_000n },
      { method: "CASH", currency: "USD", amount: 50n },
    ]);
    expect(r.derivedMethod).toBe("CASH");
    expect(r.settledVnd).toBe(3_000_000n);
    expect(r.settledUsd).toBe(50);
    expect(r.settledKrw).toBeNull();
  });

  it("(수단,통화) 중복 라인 → 합산 병합, 1건으로 축약", () => {
    const r = normalizeSettlementLines([
      { method: "CASH", currency: "VND", amount: 1_000_000n },
      { method: "CASH", currency: "VND", amount: 2_000_000n },
      { method: "BANK_TRANSFER", currency: "VND", amount: 500_000n },
    ]);
    // 현금 VND 병합(3백만) + 이체 VND(50만) = 2건
    expect(r.lines).toHaveLength(2);
    const cashVnd = r.lines.find((l) => l.method === "CASH" && l.currency === "VND")!;
    expect(cashVnd.amount).toBe(3_000_000n);
    expect(r.settledVnd).toBe(3_500_000n);
    expect(r.derivedMethod).toBe("MIXED");
  });

  it("KRW/USD 합계는 number로 변환, VND는 BigInt 유지", () => {
    const r = normalizeSettlementLines([
      { method: "CASH", currency: "KRW", amount: 100_000n },
      { method: "CASH", currency: "USD", amount: 30n },
    ]);
    expect(typeof r.settledKrw).toBe("number");
    expect(typeof r.settledUsd).toBe("number");
    expect(r.settledVnd).toBeNull();
  });

  it("amount ≤ 0 → RangeError", () => {
    expect(() =>
      normalizeSettlementLines([{ method: "CASH", currency: "VND", amount: 0n }])
    ).toThrow(RangeError);
    expect(() =>
      normalizeSettlementLines([{ method: "CASH", currency: "VND", amount: -1n }])
    ).toThrow(RangeError);
  });

  it("라인 수 > 12 → RangeError", () => {
    const lines = Array.from({ length: 13 }, () => ({
      method: "CASH" as const,
      currency: "VND" as const,
      amount: 1_000n,
    }));
    expect(() => normalizeSettlementLines(lines)).toThrow(RangeError);
  });

  it("라인 수 12 정확히 → 통과", () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({
      method: "CASH" as const,
      currency: (i % 2 === 0 ? "VND" : "KRW") as "VND" | "KRW",
      amount: 1_000n,
    }));
    expect(() => normalizeSettlementLines(lines)).not.toThrow();
  });

  it("KRW 합계가 Number 안전범위 초과 → RangeError", () => {
    const over = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(() =>
      normalizeSettlementLines([{ method: "CASH", currency: "KRW", amount: over }])
    ).toThrow(RangeError);
  });

  it("입력 배열을 변형하지 않는다(병합은 복제본에서)", () => {
    const input: SettlementLineInput[] = [
      { method: "CASH", currency: "VND", amount: 1_000_000n },
      { method: "CASH", currency: "VND", amount: 2_000_000n },
    ];
    normalizeSettlementLines(input);
    expect(input[0].amount).toBe(1_000_000n);
    expect(input[1].amount).toBe(2_000_000n);
  });

  // ── 보증금 상계(DEPOSIT 라인, ADR-0041) ──────────────────────────────────
  it("DEPOSIT 단독(VND) → derivedMethod=DEPOSIT + depositOffsetVnd=amount + settledVnd 포함", () => {
    const r = normalizeSettlementLines([
      { method: "DEPOSIT", currency: "VND", amount: 2_000_000n },
    ]);
    expect(r.derivedMethod).toBe("DEPOSIT");
    expect(r.depositOffsetVnd).toBe(2_000_000n);
    // settledVnd는 청구 커버리지 캐시 — DEPOSIT 라인도 포함
    expect(r.settledVnd).toBe(2_000_000n);
    expect(r.lines).toHaveLength(1);
  });

  it("DEPOSIT + 현금 혼합 → MIXED + depositOffsetVnd는 DEPOSIT만 합산", () => {
    const r = normalizeSettlementLines([
      { method: "DEPOSIT", currency: "VND", amount: 2_000_000n },
      { method: "CASH", currency: "VND", amount: 500_000n },
    ]);
    expect(r.derivedMethod).toBe("MIXED");
    expect(r.depositOffsetVnd).toBe(2_000_000n); // 현금은 제외
    expect(r.settledVnd).toBe(2_500_000n); // 청구 커버리지 = 상계 + 현금
  });

  it("DEPOSIT 라인 중복 → 합산 병합, depositOffsetVnd 누적", () => {
    const r = normalizeSettlementLines([
      { method: "DEPOSIT", currency: "VND", amount: 1_000_000n },
      { method: "DEPOSIT", currency: "VND", amount: 700_000n },
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.depositOffsetVnd).toBe(1_700_000n);
    expect(r.derivedMethod).toBe("DEPOSIT");
  });

  it("DEPOSIT 라인 currency≠VND(KRW/USD) → RangeError", () => {
    expect(() =>
      normalizeSettlementLines([{ method: "DEPOSIT", currency: "KRW", amount: 100_000n }])
    ).toThrow(RangeError);
    expect(() =>
      normalizeSettlementLines([{ method: "DEPOSIT", currency: "USD", amount: 50n }])
    ).toThrow(RangeError);
  });

  it("DEPOSIT 없으면 depositOffsetVnd=0n", () => {
    const r = normalizeSettlementLines([{ method: "CASH", currency: "VND", amount: 500_000n }]);
    expect(r.depositOffsetVnd).toBe(0n);
  });
});
