// B2C 취소 환불 계산 (ADR-0048 §8-3, P6) — 순수 함수 층.
//   공식: 위약금 = (100 − 환불율%) × 총액(VND 앵커) / 100.  환불 = 낸금액 − 위약금 (0 미만이면 0).
//   환불율%는 기존 취소규정(CANCELLATION_POLICY) tier를 그대로 재사용(총액 기준).
//   환불은 "낸 통화·낸 금액 그대로" — 최신 결제부터(LIFO) 배분, 마지막 닿는 결제만 비례 부분환불.
//   ★기록만: 실제 송금은 외부 처리(deposit 환불과 동일 철학, lib/checkout). 재환산 없음.
import { Currency } from "@prisma/client";

/** 취소 시점 잔여일(체크인까지 D-n)에 해당하는 환불율(%). tiers는 fromDays 내림차순(취소규정 규약). */
export function resolveRefundPct(
  tiers: { fromDays: number; refundPct: number }[],
  daysUntilCheckIn: number
): number {
  for (const t of tiers) {
    if (daysUntilCheckIn >= t.fromDays) return t.refundPct;
  }
  return 0; // 정합 tiers면 마지막 -1이 항상 매칭 — 방어적 폴백
}

export interface B2cPaidRecord {
  paymentId: string;
  currency: Currency;
  /** 낸 실금액(청구통화 최소단위) */
  amount: bigint;
  /** VND 환산(위약금 상계·앵커 기준) */
  vndEquivalent: bigint;
  /** LIFO 정렬용 수납 시각 */
  receivedAt: Date;
}

export interface B2cRefundLine {
  paymentId: string;
  currency: Currency;
  /** 이 결제 건에서 되돌릴 금액(낸 통화, 최소단위) */
  refundAmount: bigint;
  /** 그 VND 환산분 */
  refundVndEquivalent: bigint;
}

export interface B2cRefundResult {
  refundPct: number;
  paidVnd: bigint;
  penaltyVnd: bigint;
  /** 환불 가능 총액(VND) = max(0, 낸금액 − 위약금) */
  refundableVnd: bigint;
  /** 낸 통화별 환불 배분(LIFO) */
  lines: B2cRefundLine[];
}

/**
 * B2C 취소 환불 계산. 위약금은 VND 앵커 기준, 환불은 낸 결제 건에 최신순(LIFO) 배분.
 * @param totalVnd 객실료 총액 VND(앵커)
 * @param refundPct 취소규정 tier 환불율(총액 기준)
 * @param payments 낸 B2C 결제(계약금·잔금). 내부에서 receivedAt 내림차순 정렬.
 */
export function computeB2cRefund(
  totalVnd: bigint,
  refundPct: number,
  payments: B2cPaidRecord[]
): B2cRefundResult {
  const pct = BigInt(Math.max(0, Math.min(100, Math.trunc(refundPct))));
  const total = totalVnd > 0n ? totalVnd : 0n;
  const penaltyVnd = ((100n - pct) * total) / 100n; // floor(위약금)
  const paidVnd = payments.reduce((s, p) => s + p.vndEquivalent, 0n);
  const refundableVnd = paidVnd > penaltyVnd ? paidVnd - penaltyVnd : 0n;

  const lines: B2cRefundLine[] = [];
  let remaining = refundableVnd;
  // 최신 결제부터(LIFO) — 잔금을 먼저 되돌리고 계약금은 나중(관례·직관 부합)
  const ordered = [...payments].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  for (const p of ordered) {
    if (remaining <= 0n) break;
    const refundVnd = remaining >= p.vndEquivalent ? p.vndEquivalent : remaining;
    const refundAmount =
      refundVnd >= p.vndEquivalent
        ? p.amount // 전액 환불 → 낸 금액 그대로
        : p.vndEquivalent > 0n
          ? (p.amount * refundVnd) / p.vndEquivalent // 비례 부분환불(floor)
          : 0n;
    lines.push({ paymentId: p.paymentId, currency: p.currency, refundAmount, refundVndEquivalent: refundVnd });
    remaining -= refundVnd;
  }
  return { refundPct, paidVnd, penaltyVnd, refundableVnd, lines };
}
