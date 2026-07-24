// B2C 계약금/잔금 분할 결제 — 스케줄 계산 (순수 함수 층, ADR-0048)
//
// VND가 앵커(진실). 이 모듈은 "얼마를 언제 받을지"의 VND 스케줄만 계산한다. 실제 청구통화(KRW/USD)
// 환산·확정은 결제 시점에 Payment.fxRateToVnd로 이뤄지므로 여기서는 다루지 않는다(계층 분리).
//
// 정책(테오 2026-07-24, ADR-0048 §8): 계약금 50% / 잔금 체크인 D-14 / 14일 이내 예약 = 100% 선결제.
// 값은 AppSetting(B2C_DEPOSIT_RATE_PCT·B2C_BALANCE_LEAD_DAYS)으로 조정 — 이 순수함수는 인자로 받는다.

import { Currency } from "@prisma/client";
import { krwToVndSnapshot, usdToVndSnapshot } from "./pricing";

/** 정책 기본값 (AppSetting 미설정 시 폴백). B2B(DEFAULT_DEPOSIT_RATE_PCT=30)와 별개. */
export const B2C_DEFAULT_DEPOSIT_RATE_PCT = 50;
export const B2C_DEFAULT_BALANCE_LEAD_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/** UTC 자정 기준 날짜만 추출 (@db.Date 규약 — 시간 없음). */
function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** UTC 자정 날짜에 일수 가산. */
function addDaysUtc(date: Date, days: number): Date {
  const d = toUtcDateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * 계약금 VND = ceil(총액 × 율%). 동 단위 올림(부족수금 방지) — B2B computeDepositDue와 동일 규율.
 * 율은 0~100 클램프. 음수·0 총액은 0.
 */
export function computeB2cDepositVnd(totalVnd: bigint, depositRatePct: number): bigint {
  if (totalVnd <= 0n) return 0n;
  const pct = BigInt(Math.max(0, Math.min(100, Math.trunc(depositRatePct))));
  return (totalVnd * pct + 99n) / 100n; // ceil division
}

export interface B2cScheduleInput {
  /** 객실료 총액 VND = 앵커(진실). BigInt(동). */
  totalVnd: bigint;
  /** 숙박 체크인일(@db.Date, UTC 자정). */
  checkIn: Date;
  /** 스케줄 산출 기준 시각(예약 확정 시각). 테스트 결정성을 위해 주입. */
  now: Date;
  /** 계약금율(%) — AppSetting 해석값. 미지정 시 정책 기본 50. */
  depositRatePct?: number;
  /** 잔금 선행일수(체크인 D-N) — AppSetting 해석값. 미지정 시 정책 기본 14. */
  balanceLeadDays?: number;
}

export interface B2cSchedule {
  /** 체크인 임박(D-lead 이내)이라 분할 없이 100% 선결제인가. */
  fullPrepay: boolean;
  /** 계약금 청구 VND(앵커 몫). fullPrepay면 총액 전액. */
  depositDueVnd: bigint;
  /** 잔금 청구 VND(앵커 몫). fullPrepay면 0. depositDueVnd + balanceDueVnd = totalVnd(항상). */
  balanceDueVnd: bigint;
  /** 계약금 기한 = 예약 확정 시점(즉시). UTC 자정 날짜. */
  depositDueDate: Date;
  /** 잔금 기한 = 체크인 − leadDays. fullPrepay면 null(잔금 없음). */
  balanceDueDate: Date | null;
}

/**
 * B2C 분할 결제 스케줄 산출 (VND 앵커).
 *
 * - 체크인까지 남은 일수 ≤ leadDays → **100% 선결제**(계약금=총액, 잔금=0, 잔금기한 없음).
 * - 그 외 → 계약금 = ceil(총액×율%), **잔금 = 총액 − 계약금**(반올림 손실 0 — 앵커 정확 보존),
 *   잔금기한 = 체크인 − leadDays.
 *
 * ⚠ 청구통화(KRW/USD) 금액은 여기서 산출하지 않는다 — 결제 시점 FX(Payment.fxRateToVnd)로 확정.
 */
export function computeB2cSchedule(input: B2cScheduleInput): B2cSchedule {
  const depositRatePct = input.depositRatePct ?? B2C_DEFAULT_DEPOSIT_RATE_PCT;
  const balanceLeadDays = Math.max(0, Math.trunc(input.balanceLeadDays ?? B2C_DEFAULT_BALANCE_LEAD_DAYS));

  const checkInDate = toUtcDateOnly(input.checkIn);
  const nowDate = toUtcDateOnly(input.now);
  const balanceDueDate = addDaysUtc(checkInDate, -balanceLeadDays);

  // 잔금 기한이 오늘 이하(이미 지났거나 오늘)면 분할할 시간이 없음 → 100% 선결제.
  const fullPrepay = balanceDueDate.getTime() <= nowDate.getTime();

  if (fullPrepay) {
    return {
      fullPrepay: true,
      depositDueVnd: input.totalVnd > 0n ? input.totalVnd : 0n,
      balanceDueVnd: 0n,
      depositDueDate: nowDate,
      balanceDueDate: null,
    };
  }

  const depositDueVnd = computeB2cDepositVnd(input.totalVnd, depositRatePct);
  // 잔금 = 총액 − 계약금 (직접 차감 → deposit+balance=total 항상 정확, 반올림 잔차 없음)
  const balanceDueVnd = input.totalVnd > depositDueVnd ? input.totalVnd - depositDueVnd : 0n;

  return {
    fullPrepay: false,
    depositDueVnd,
    balanceDueVnd,
    depositDueDate: nowDate,
    balanceDueDate,
  };
}

/** 남은 미청구/미납 잔액 = 총액 − Σ 확정 결제 VND환산(음수면 0). 앵커 기준. */
export function b2cOutstandingVnd(totalVnd: bigint, paidVndEquivalents: bigint[]): bigint {
  const paid = paidVndEquivalents.reduce((s, v) => s + v, 0n);
  const remaining = totalVnd - paid;
  return remaining > 0n ? remaining : 0n;
}

// ===================== P3a — 예약 → 스케줄 앵커 브리지 =====================
// 스케줄의 진실은 VND(앵커). 예약은 청구통화(KRW/USD)로 팔릴 수 있으므로, 예약 시점 스냅샷 환율로
// VND 앵커를 산출한다(revenue-ledger의 환산 규칙과 동일 — krw/usdToVndSnapshot 재사용, 드리프트 0).

/** 예약의 청구통화·총액·스냅샷 환율 (Booking에서 발췌). VND 앵커 산출 입력. */
export interface BookingAnchorInput {
  saleCurrency: Currency;
  totalSaleKrw: number | null;
  totalSaleVnd: bigint | null;
  totalSaleUsd: number | null;
  /** 예약 시점 KRW 스냅샷(1 KRW = x VND). Decimal → 문자열. */
  fxVndPerKrw: string | null;
  /** 예약 시점 USD 스냅샷(1 USD = x VND). Decimal → 문자열. */
  fxVndPerUsd: string | null;
}

/**
 * 예약의 VND 앵커 산출 (청구통화 → VND, 예약 시점 스냅샷 FX).
 *  - VND 청구: totalSaleVnd 그대로.
 *  - KRW 청구: totalSaleKrw × fxVndPerKrw (스냅샷).
 *  - USD 청구: totalSaleUsd × fxVndPerUsd (스냅샷).
 * 환율·총액이 없어 산출 불가면 null(스케줄 생성 불가 — 호출자가 견적 재확인).
 */
export function resolveBookingAnchorVnd(b: BookingAnchorInput): bigint | null {
  switch (b.saleCurrency) {
    case Currency.VND:
      return b.totalSaleVnd ?? null;
    case Currency.KRW:
      if (b.totalSaleKrw == null || b.fxVndPerKrw == null) return null;
      return krwToVndSnapshot(b.totalSaleKrw, b.fxVndPerKrw);
    case Currency.USD:
      if (b.totalSaleUsd == null || b.fxVndPerUsd == null) return null;
      return usdToVndSnapshot(b.totalSaleUsd, b.fxVndPerUsd);
    default:
      return null;
  }
}

export interface B2cScheduleCreateInput extends BookingAnchorInput {
  bookingId: string;
  checkIn: Date;
  now: Date;
  depositRatePct?: number;
  balanceLeadDays?: number;
}

/** B2cPaymentSchedule 생성 페이로드 (Prisma create 입력 호환). */
export interface B2cScheduleCreateData {
  bookingId: string;
  totalVnd: bigint;
  depositRatePct: number;
  depositDueVnd: bigint;
  balanceDueVnd: bigint;
  depositDueDate: Date;
  balanceDueDate: Date | null;
  fullPrepay: boolean;
}

/**
 * 예약 1건 → B2cPaymentSchedule 생성 데이터. 앵커 산출 불가(환율 없음·총액 0)면 null.
 * 적용 계약금율(depositRatePct)은 스냅샷으로 저장한다(이후 AppSetting이 바뀌어도 이 예약은 불변).
 */
export function buildB2cScheduleCreate(input: B2cScheduleCreateInput): B2cScheduleCreateData | null {
  const totalVnd = resolveBookingAnchorVnd(input);
  if (totalVnd == null || totalVnd <= 0n) return null;
  const depositRatePct = input.depositRatePct ?? B2C_DEFAULT_DEPOSIT_RATE_PCT;
  const s = computeB2cSchedule({
    totalVnd,
    checkIn: input.checkIn,
    now: input.now,
    depositRatePct,
    balanceLeadDays: input.balanceLeadDays,
  });
  return {
    bookingId: input.bookingId,
    totalVnd,
    depositRatePct,
    depositDueVnd: s.depositDueVnd,
    balanceDueVnd: s.balanceDueVnd,
    depositDueDate: s.depositDueDate,
    balanceDueDate: s.balanceDueDate,
    fullPrepay: s.fullPrepay,
  };
}
