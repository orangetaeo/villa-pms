// lib/payment.ts — 정산 2차 P2-1: 실수납(Payment) 순수 로직층.
//
// ★ ADMIN(canViewFinance) 전용 데이터 — 수납액·미수·VND환산은 공급자에 절대 노출 금지.
// 계약: docs/contracts/T-settlement-payment-recording.md
//
// 규칙(money-pattern):
//  - 모든 금액 BigInt(통화 최소단위: KRW 원, VND 동). float 금지, 합산만.
//  - VND 환산은 수납 시점 환율(fxRateToVnd, Decimal(14,4) 문자열)로 half-up. KRW 수납은 환율 필수.
//  - 지원 통화 화이트리스트(KRW·VND)만 — 그 외(USD 등)는 throw.
import { Currency } from "@prisma/client";

/** 환율 문자열 "정수[.소수4자리]" → ×1e4 BigInt. 형식 오류·0이하는 throw. */
function fxScaled(fxRateToVnd: string): bigint {
  if (!/^\d+(\.\d{1,4})?$/.test(fxRateToVnd)) {
    throw new RangeError(`잘못된 환율 형식: ${fxRateToVnd} (소수 4자리까지 숫자)`);
  }
  const [int, frac = ""] = fxRateToVnd.split(".");
  const scaled = BigInt(int + frac.padEnd(4, "0"));
  if (scaled <= 0n) throw new RangeError("환율은 0보다 커야 합니다");
  return scaled;
}

/**
 * 한 건 수납액의 VND 환산.
 *  - VND: 그대로(환율 무시).
 *  - KRW: amount × fxRateToVnd, half-up. fxRateToVnd 없으면 throw(허위 0 금지).
 *  - 그 외 통화: throw.
 */
export function computeVndEquivalent(
  currency: Currency,
  amount: bigint,
  fxRateToVnd: string | null
): bigint {
  if (amount < 0n) throw new RangeError(`수납액은 음수일 수 없습니다: ${amount}`);
  if (currency === Currency.VND) return amount;
  if (currency === Currency.KRW) {
    if (!fxRateToVnd) {
      throw new RangeError("KRW 수납은 수납 시점 환율(fxRateToVnd)이 필수입니다");
    }
    // vnd = amount × (scaled/1e4), half-up
    return (amount * fxScaled(fxRateToVnd) + 5_000n) / 10_000n;
  }
  throw new RangeError(`수납 미지원 통화: ${currency}`);
}

/** 수납 상태 — 견적 대비 실수납 합 비교 결과 */
export type CollectionStatus = "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";

/** 수납 요약 입력 — 한 건의 통화·금액·환율(이미 저장된 vndEquivalent를 신뢰) */
export interface PaymentLike {
  currency: Currency;
  amount: bigint;
  /** 저장된 VND 환산(수납 시점). null이면 즉석 계산이 필요하나 정상 기록은 항상 채움 */
  vndEquivalent: bigint | null;
  fxRateToVnd?: string | null;
}

export interface CollectionSummary {
  /** 실수납 VND환산 합계 */
  collectedVndEquivalent: bigint;
  /** 통화별 실수납 합 (원통화 단위) */
  collectedByCurrency: Partial<Record<Currency, bigint>>;
  /** 견적 판매가 VND환산 (호출부가 스냅샷으로 산출해 주입) */
  expectedVndEquivalent: bigint;
  /** 미수(양수) / 초과(음수) = 견적 − 실수납 */
  outstandingVnd: bigint;
  status: CollectionStatus;
  paymentCount: number;
}

/** 한 건 수납의 VND환산 — 저장값 우선, 없으면 통화·환율로 계산 */
function vndOf(p: PaymentLike): bigint {
  if (p.vndEquivalent != null) return p.vndEquivalent;
  return computeVndEquivalent(p.currency, p.amount, p.fxRateToVnd ?? null);
}

/**
 * 예약 한 건의 수납 요약 — 견적 VND환산(expectedVndEquivalent) 대비 실수납 합.
 * expectedVndEquivalent는 호출부가 Booking 판매가 스냅샷으로 산출(KRW는 fxVndPerKrw 환산).
 */
export function summarizeCollection(
  payments: readonly PaymentLike[],
  expectedVndEquivalent: bigint
): CollectionSummary {
  let collected = 0n;
  const byCurrency: Partial<Record<Currency, bigint>> = {};
  for (const p of payments) {
    collected += vndOf(p);
    byCurrency[p.currency] = (byCurrency[p.currency] ?? 0n) + p.amount;
  }
  const outstanding = expectedVndEquivalent - collected;
  let status: CollectionStatus;
  if (collected === 0n) status = "UNPAID";
  else if (collected < expectedVndEquivalent) status = "PARTIAL";
  else if (collected === expectedVndEquivalent) status = "PAID";
  else status = "OVERPAID";
  return {
    collectedVndEquivalent: collected,
    collectedByCurrency: byCurrency,
    expectedVndEquivalent,
    outstandingVnd: outstanding,
    status,
    paymentCount: payments.length,
  };
}
