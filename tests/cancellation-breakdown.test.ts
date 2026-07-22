import { describe, it, expect } from "vitest";
import {
  computeCancellationBreakdown,
  daysUntilCheckIn,
  findLossWindows,
} from "@/lib/cancellation-breakdown";
import { SUPPLIER_ALIGNED_TIERS, parseCancellationPolicy } from "@/lib/cancellation-policy";
import { DEFAULT_CANCEL_TIERS } from "@/lib/cancel-tiers";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
/** VN(UTC+7) 기준 특정 날짜 정오 — 달력일 경계 흔들림 없이 판정하기 위해 */
const atVn = (s: string) => new Date(`${s}T05:00:00.000Z`); // VN 12:00

describe("daysUntilCheckIn (VN 달력일)", () => {
  it("미래·당일·과거", () => {
    expect(daysUntilCheckIn(d("2026-08-01"), atVn("2026-07-22"))).toBe(10);
    expect(daysUntilCheckIn(d("2026-07-22"), atVn("2026-07-22"))).toBe(0); // 당일
    expect(daysUntilCheckIn(d("2026-07-21"), atVn("2026-07-22"))).toBe(-1); // 지남
  });
});

describe("취소 산출 — 정합 5단계(고객)×계약 5단계(공급자)", () => {
  const base = {
    guestTiers: SUPPLIER_ALIGNED_TIERS,
    supplierTiers: DEFAULT_CANCEL_TIERS,
    totalKrw: 1_000_000,
    costVnd: 14_000_000n,
  };

  it("체크인 10일 전(8~13일 구간) → 환불 80%·지급 20%·손실 0", () => {
    const b = computeCancellationBreakdown({
      ...base,
      checkIn: d("2026-08-01"),
      cancelAt: atVn("2026-07-22"),
    });
    expect(b.daysBefore).toBe(10);
    expect(b.guestRefundPct).toBe(80);
    expect(b.supplierPayPct).toBe(20);
    expect(b.companyLossPct).toBe(0);
    expect(b.refundKrw).toBe(800_000);
    expect(b.penaltyKrw).toBe(200_000);
    expect(b.supplierPayVnd).toBe(2_800_000n);
  });

  it("체크인 5일 전(1~7일 구간) → 환불 50%·지급 50%", () => {
    const b = computeCancellationBreakdown({
      ...base,
      checkIn: d("2026-07-27"),
      cancelAt: atVn("2026-07-22"),
    });
    expect(b.daysBefore).toBe(5);
    expect(b.guestRefundPct).toBe(50);
    expect(b.supplierPayPct).toBe(50);
    expect(b.refundKrw).toBe(500_000);
    expect(b.supplierPayVnd).toBe(7_000_000n);
  });

  it("체크인 20일 전 → 전액 환불·지급 0(우리 손실 0)", () => {
    const b = computeCancellationBreakdown({
      ...base,
      checkIn: d("2026-08-11"),
      cancelAt: atVn("2026-07-22"),
    });
    expect(b.guestRefundPct).toBe(100);
    expect(b.supplierPayPct).toBe(0);
    expect(b.refundKrw).toBe(1_000_000);
    expect(b.supplierPayVnd).toBe(0n);
  });

  it("노쇼 → 환불 0·지급 100%", () => {
    const b = computeCancellationBreakdown({ ...base, checkIn: d("2026-08-01"), noShow: true });
    expect(b.daysBefore).toBe(-1);
    expect(b.guestRefundPct).toBe(0);
    expect(b.supplierPayPct).toBe(100);
    expect(b.refundKrw).toBe(0);
    expect(b.penaltyKrw).toBe(1_000_000);
    expect(b.supplierPayVnd).toBe(14_000_000n);
  });

  it("★ 어느 시점에 취소해도 회사 손실 0 (정합 프리셋의 핵심 성질)", () => {
    for (const day of [40, 14, 13, 8, 7, 1, 0]) {
      const checkIn = new Date(Date.UTC(2026, 6, 22) + day * 86_400_000);
      const b = computeCancellationBreakdown({
        ...base,
        checkIn,
        cancelAt: atVn("2026-07-22"),
      });
      expect(b.companyLossPct).toBe(0);
    }
  });

  it("금액 미제공(STAFF 시야)이면 비율만 산출", () => {
    const b = computeCancellationBreakdown({
      guestTiers: SUPPLIER_ALIGNED_TIERS,
      supplierTiers: DEFAULT_CANCEL_TIERS,
      checkIn: d("2026-08-01"),
      cancelAt: atVn("2026-07-22"),
      totalKrw: null,
      costVnd: null,
    });
    expect(b.guestRefundPct).toBe(80);
    expect(b.refundKrw).toBeNull();
    expect(b.supplierPayVnd).toBeNull();
  });

  it("계약에 단계표가 없으면(레거시) 지급률·손실은 null — 수동 판단", () => {
    const b = computeCancellationBreakdown({
      guestTiers: SUPPLIER_ALIGNED_TIERS,
      supplierTiers: null,
      checkIn: d("2026-08-01"),
      cancelAt: atVn("2026-07-22"),
      totalKrw: 1_000_000,
      costVnd: 14_000_000n,
    });
    expect(b.supplierPayPct).toBeNull();
    expect(b.supplierPayVnd).toBeNull();
    expect(b.companyLossPct).toBeNull();
    expect(b.refundKrw).toBe(800_000); // 고객 쪽은 계약과 무관하게 산출 가능
  });
});

describe("★ 정책 ↔ 계약 정합성 (findLossWindows)", () => {
  const current = parseCancellationPolicy(null).tiers; // 현행 운영값 30/14/50

  it("현행 고객 정책 × 공급자 5단계 → 손실 구간 없음", () => {
    // 실측(hand-check): 모든 경계에서 지급률 ≤ 위약금률.
    //   d=13일 전이면 고객 환불 0%(위약금 100)인데 공급자 지급은 20%뿐 —
    //   어긋남의 방향이 "고객에게 엄격, 공급자에게 후함"이라 회사 손실이 아니다.
    expect(findLossWindows(current, DEFAULT_CANCEL_TIERS)).toEqual([]);
  });

  it("고객에게 후한 정책이면 손실 구간을 잡아낸다", () => {
    // 체크인 8일 전까지 100% 환불(위약금 0)인데 계약은 공급자에게 20% 지급 → 20%p 회사 부담
    const tooGenerous = [
      { fromDays: 30, refundPct: 100 },
      { fromDays: 8, refundPct: 100 },
      { fromDays: -1, refundPct: 0 },
    ];
    const windows = findLossWindows(tooGenerous, DEFAULT_CANCEL_TIERS);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows).toContainEqual({
      daysBefore: 8,
      guestRefundPct: 100,
      supplierPayPct: 20,
      lossPct: 20,
    });
    for (const w of windows) {
      expect(w.lossPct).toBe(w.supplierPayPct - (100 - w.guestRefundPct));
    }
  });

  it("정합 프리셋은 손실 구간 0", () => {
    expect(findLossWindows(SUPPLIER_ALIGNED_TIERS, DEFAULT_CANCEL_TIERS)).toEqual([]);
  });

  it("계약 단계표가 없으면 경고 대상 없음", () => {
    expect(findLossWindows(current, null)).toEqual([]);
  });
});
