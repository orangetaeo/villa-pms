import { describe, it, expect } from "vitest";
import {
  computeB2cDepositVnd,
  computeB2cSchedule,
  b2cOutstandingVnd,
  B2C_DEFAULT_DEPOSIT_RATE_PCT,
  B2C_DEFAULT_BALANCE_LEAD_DAYS,
} from "./b2c-payment";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("computeB2cDepositVnd — 계약금 = ceil(총액 × 율%)", () => {
  it("50% 정확 분할", () => {
    expect(computeB2cDepositVnd(10_000_000n, 50)).toBe(5_000_000n);
  });
  it("나눠떨어지지 않으면 올림(부족수금 방지)", () => {
    expect(computeB2cDepositVnd(10_000_001n, 50)).toBe(5_000_001n); // 5,000,000.5 → 올림
  });
  it("율 클램프(0~100)·음수 총액 0", () => {
    expect(computeB2cDepositVnd(1_000_000n, 150)).toBe(1_000_000n);
    expect(computeB2cDepositVnd(1_000_000n, -10)).toBe(0n);
    expect(computeB2cDepositVnd(-5n, 50)).toBe(0n);
  });
});

describe("computeB2cSchedule — VND 앵커 분할", () => {
  const base = {
    totalVnd: 10_000_001n, // 홀수 → 반올림 잔차 검증용
    now: d("2026-08-01"),
  };

  it("일반 예약(체크인 넉넉) → 계약금 50% + 잔금, 합계=총액(잔차 0)", () => {
    const s = computeB2cSchedule({ ...base, checkIn: d("2026-09-10") }); // D-40
    expect(s.fullPrepay).toBe(false);
    expect(s.depositDueVnd).toBe(5_000_001n); // ceil
    expect(s.balanceDueVnd).toBe(5_000_000n); // total − deposit
    expect(s.depositDueVnd + s.balanceDueVnd).toBe(base.totalVnd); // ★앵커 정확 보존
    expect(s.balanceDueDate).toEqual(d("2026-08-27")); // 체크인 − 14
    expect(s.depositDueDate).toEqual(d("2026-08-01"));
  });

  it("체크인 14일 이내 예약 → 100% 선결제(계약금=총액, 잔금=0, 잔금기한 null)", () => {
    const s = computeB2cSchedule({ ...base, checkIn: d("2026-08-10") }); // D-9
    expect(s.fullPrepay).toBe(true);
    expect(s.depositDueVnd).toBe(base.totalVnd);
    expect(s.balanceDueVnd).toBe(0n);
    expect(s.balanceDueDate).toBeNull();
  });

  it("경계: 잔금기한이 정확히 오늘이면 100% 선결제(분할 시간 없음)", () => {
    // 체크인 − 14 = now(2026-08-01) → 체크인 2026-08-15
    const s = computeB2cSchedule({ ...base, checkIn: d("2026-08-15") });
    expect(s.fullPrepay).toBe(true);
  });

  it("경계: 잔금기한이 내일이면 분할 성립", () => {
    // 체크인 − 14 = 2026-08-02 (내일) → 체크인 2026-08-16
    const s = computeB2cSchedule({ ...base, checkIn: d("2026-08-16") });
    expect(s.fullPrepay).toBe(false);
    expect(s.balanceDueDate).toEqual(d("2026-08-02"));
  });

  it("AppSetting 오버라이드(30%·D-30) 반영", () => {
    const s = computeB2cSchedule({
      totalVnd: 10_000_000n,
      now: d("2026-08-01"),
      checkIn: d("2026-10-01"),
      depositRatePct: 30,
      balanceLeadDays: 30,
    });
    expect(s.depositDueVnd).toBe(3_000_000n);
    expect(s.balanceDueVnd).toBe(7_000_000n);
    expect(s.balanceDueDate).toEqual(d("2026-09-01")); // 체크인 − 30
  });

  it("기본값 상수 = 정책(50% · D-14)", () => {
    expect(B2C_DEFAULT_DEPOSIT_RATE_PCT).toBe(50);
    expect(B2C_DEFAULT_BALANCE_LEAD_DAYS).toBe(14);
    const s = computeB2cSchedule({ totalVnd: 8_000_000n, now: d("2026-08-01"), checkIn: d("2026-09-30") });
    expect(s.depositDueVnd).toBe(4_000_000n); // 50%
  });
});

describe("b2cOutstandingVnd — 앵커 대비 미납 잔액", () => {
  it("계약금만 납부 → 잔금 남음", () => {
    expect(b2cOutstandingVnd(10_000_000n, [5_000_000n])).toBe(5_000_000n);
  });
  it("완납 → 0", () => {
    expect(b2cOutstandingVnd(10_000_000n, [5_000_000n, 5_000_000n])).toBe(0n);
  });
  it("과납(환차 등)이어도 음수 아님 → 0", () => {
    expect(b2cOutstandingVnd(10_000_000n, [5_000_000n, 5_100_000n])).toBe(0n);
  });
});
