import { describe, it, expect } from "vitest";
import { Currency, B2cScheduleStatus } from "@prisma/client";
import {
  computeB2cDepositVnd,
  computeB2cSchedule,
  b2cOutstandingVnd,
  deriveB2cScheduleStatus,
  resolveBookingAnchorVnd,
  buildB2cScheduleCreate,
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

describe("deriveB2cScheduleStatus — 결제 누적 → 상태 전이", () => {
  const s = { totalVnd: 10_000_000n, depositDueVnd: 5_000_000n };
  it("미납 → PENDING", () => {
    expect(deriveB2cScheduleStatus(s, 0n, 0n)).toBe(B2cScheduleStatus.PENDING);
  });
  it("계약금 일부만 → PENDING", () => {
    expect(deriveB2cScheduleStatus(s, 4_000_000n, 0n)).toBe(B2cScheduleStatus.PENDING);
  });
  it("계약금 완납 → DEPOSIT_PAID", () => {
    expect(deriveB2cScheduleStatus(s, 5_000_000n, 0n)).toBe(B2cScheduleStatus.DEPOSIT_PAID);
  });
  it("전액 완납 → PAID", () => {
    expect(deriveB2cScheduleStatus(s, 5_000_000n, 5_000_000n)).toBe(B2cScheduleStatus.PAID);
  });
  it("과납(환차)이어도 PAID", () => {
    expect(deriveB2cScheduleStatus(s, 5_000_000n, 5_100_000n)).toBe(B2cScheduleStatus.PAID);
  });
  it("fullPrepay(계약금=총액) 전액 한 번에 → PAID", () => {
    const fp = { totalVnd: 10_000_000n, depositDueVnd: 10_000_000n };
    expect(deriveB2cScheduleStatus(fp, 10_000_000n, 0n)).toBe(B2cScheduleStatus.PAID);
  });
});

describe("resolveBookingAnchorVnd — 청구통화 → VND 앵커(스냅샷 FX)", () => {
  const nullAmts = { totalSaleKrw: null, totalSaleVnd: null, totalSaleUsd: null, fxVndPerKrw: null, fxVndPerUsd: null };

  it("VND 청구 → totalSaleVnd 그대로", () => {
    expect(resolveBookingAnchorVnd({ ...nullAmts, saleCurrency: Currency.VND, totalSaleVnd: 12_000_000n })).toBe(12_000_000n);
  });
  it("KRW 청구 → totalSaleKrw × fxVndPerKrw 스냅샷", () => {
    // 250,000원 × 18.5 = 4,625,000동
    expect(
      resolveBookingAnchorVnd({ ...nullAmts, saleCurrency: Currency.KRW, totalSaleKrw: 250_000, fxVndPerKrw: "18.5" })
    ).toBe(4_625_000n);
  });
  it("USD 청구 → totalSaleUsd × fxVndPerUsd 스냅샷", () => {
    // 500$ × 25,400 = 12,700,000동
    expect(
      resolveBookingAnchorVnd({ ...nullAmts, saleCurrency: Currency.USD, totalSaleUsd: 500, fxVndPerUsd: "25400" })
    ).toBe(12_700_000n);
  });
  it("환율 없으면 null (스케줄 생성 불가)", () => {
    expect(resolveBookingAnchorVnd({ ...nullAmts, saleCurrency: Currency.KRW, totalSaleKrw: 250_000 })).toBeNull();
    expect(resolveBookingAnchorVnd({ ...nullAmts, saleCurrency: Currency.USD, totalSaleUsd: 500 })).toBeNull();
  });
  it("총액 없으면 null", () => {
    expect(resolveBookingAnchorVnd({ ...nullAmts, saleCurrency: Currency.VND })).toBeNull();
  });
});

describe("buildB2cScheduleCreate — 예약 → 스케줄 생성 페이로드", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const krwBooking = {
    bookingId: "bk1",
    saleCurrency: Currency.KRW,
    totalSaleKrw: 1_000_000, // 100만원
    totalSaleVnd: null,
    totalSaleUsd: null,
    fxVndPerKrw: "18.5", // 1원=18.5동 → 앵커 18,500,000동
    fxVndPerUsd: null,
    checkIn: d("2026-10-01"),
    now: d("2026-08-01"),
  };

  it("KRW 예약 → 앵커 환산 후 50% 분할, 계약금+잔금=앵커", () => {
    const s = buildB2cScheduleCreate(krwBooking)!;
    expect(s.totalVnd).toBe(18_500_000n);
    expect(s.depositRatePct).toBe(50);
    expect(s.depositDueVnd).toBe(9_250_000n);
    expect(s.balanceDueVnd).toBe(9_250_000n);
    expect(s.depositDueVnd + s.balanceDueVnd).toBe(s.totalVnd); // ★앵커 보존
    expect(s.balanceDueDate).toEqual(d("2026-09-17")); // 체크인 − 14
    expect(s.fullPrepay).toBe(false);
  });

  it("체크인 임박 → fullPrepay(계약금=앵커, 잔금 0)", () => {
    const s = buildB2cScheduleCreate({ ...krwBooking, checkIn: d("2026-08-10") })!;
    expect(s.fullPrepay).toBe(true);
    expect(s.depositDueVnd).toBe(18_500_000n);
    expect(s.balanceDueVnd).toBe(0n);
    expect(s.balanceDueDate).toBeNull();
  });

  it("depositRatePct 스냅샷 저장(오버라이드 반영)", () => {
    const s = buildB2cScheduleCreate({ ...krwBooking, depositRatePct: 30 })!;
    expect(s.depositRatePct).toBe(30);
    expect(s.depositDueVnd).toBe(5_550_000n); // 18,500,000 × 30%
  });

  it("앵커 불가(환율 없음) → null", () => {
    expect(buildB2cScheduleCreate({ ...krwBooking, fxVndPerKrw: null })).toBeNull();
  });
});
