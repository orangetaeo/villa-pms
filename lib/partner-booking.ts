import {
  CreditTier,
  ReceivableStatus,
  type Prisma,
} from "@prisma/client";
import {
  canCreateBookingFor,
  computeDepositDue,
  computeDueDate,
  hasOverdue,
  outstandingForPartner,
  type CreditGateReason,
} from "@/lib/partner";

/**
 * 예약 ↔ 파트너 채권 연결 로직 (ADR-0022 PARTNER-2b).
 * - 예약 확정 시: 신용 게이트 평가 + PartnerReceivable 생성(B2B 객실료 채권).
 * - 입금 시: 채권 선금/잔금 반영 + 상태 재계산.
 * - 체크인 시: 등급 A(선불) 잔금 미납 차단.
 * 전부 booking.partnerId 가 있을 때만 동작 — 미지정 예약은 무영향(하위호환).
 * ⚠️ 누수: 채권·한도 산출값은 ADMIN(canViewFinance) 경로에서만 사용.
 */

/** 트랜잭션 클라이언트(Prisma.$transaction 콜백 인자) */
type Tx = Prisma.TransactionClient;

/** 여신 노출액 = 객실료 − 선금(선금은 즉시 수납 전제, 음수면 0) */
export function creditPortionVnd(totalVnd: bigint, depositDueVnd: bigint): bigint {
  const c = totalVnd - depositDueVnd;
  return c > 0n ? c : 0n;
}

/** 채권 미입금 잔액 = 총액 − 선금입금 − 잔금입금 (음수면 0) */
function unpaidVnd(rcv: {
  totalVnd: bigint;
  depositPaidVnd: bigint;
  balancePaidVnd: bigint;
}): bigint {
  const remaining = rcv.totalVnd - rcv.depositPaidVnd - rcv.balancePaidVnd;
  return remaining > 0n ? remaining : 0n;
}

export interface ReceivablePaidUpdate {
  depositPaidVnd: bigint;
  balancePaidVnd: bigint;
  status: ReceivableStatus;
}

/**
 * 입금 1건을 채권에 반영(순수) — purpose에 따라 선금/잔금 누적 + 상태 재계산.
 * 완납(>=총액)=PAID, 일부=PARTIAL, 0=PENDING. (OVERDUE는 cron이 기한 기준 별도 처리)
 */
export function applyPaymentToReceivable(
  rcv: { totalVnd: bigint; depositPaidVnd: bigint; balancePaidVnd: bigint },
  purpose: "DEPOSIT" | "BALANCE",
  vndAmount: bigint
): ReceivablePaidUpdate {
  const add = vndAmount > 0n ? vndAmount : 0n;
  const depositPaidVnd = purpose === "DEPOSIT" ? rcv.depositPaidVnd + add : rcv.depositPaidVnd;
  const balancePaidVnd = purpose === "BALANCE" ? rcv.balancePaidVnd + add : rcv.balancePaidVnd;
  const totalPaid = depositPaidVnd + balancePaidVnd;
  const status =
    totalPaid >= rcv.totalVnd
      ? ReceivableStatus.PAID
      : totalPaid > 0n
        ? ReceivableStatus.PARTIAL
        : ReceivableStatus.PENDING;
  return { depositPaidVnd, balancePaidVnd, status };
}

/**
 * 등급 A(선불)는 체크인 전 잔금 100% 입금 원칙 → 미납 잔액이 있으면 체크인 차단(순수).
 * 등급 B/C(여신)는 마감 정산이므로 체크인 시점 미납을 차단하지 않는다.
 */
export function partnerBalanceBlocksCheckIn(
  tier: CreditTier,
  rcv: { totalVnd: bigint; depositPaidVnd: bigint; balancePaidVnd: bigint } | null
): boolean {
  if (tier !== CreditTier.A) return false;
  if (!rcv) return false;
  return unpaidVnd(rcv) > 0n;
}

const OPEN_OTHERS_SELECT = {
  totalVnd: true,
  depositPaidVnd: true,
  balancePaidVnd: true,
  dueDate: true,
  status: true,
} as const;

export interface ConfirmCreditResult {
  allowed: boolean;
  reason?: CreditGateReason;
  /** 파트너 미연결 등으로 게이트 비대상이면 true */
  skipped: boolean;
}

/**
 * 예약 확정 신용 게이트 평가(DB) — 파트너 미수 + 이 예약의 여신 노출로 한도 판정.
 * 파트너 미연결이면 skipped=true(무영향). throw 하지 않음 — 호출처(confirmHold)가 차단 결정.
 */
export async function evaluateConfirmCredit(
  tx: Tx,
  bookingId: string,
  now: Date
): Promise<ConfirmCreditResult> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      partnerId: true,
      totalSaleVnd: true,
      partner: {
        select: {
          creditTier: true,
          status: true,
          creditLimitVnd: true,
          depositRatePct: true,
        },
      },
    },
  });
  if (!booking?.partnerId || !booking.partner) {
    return { allowed: true, skipped: true };
  }

  // 이 예약 외 파트너의 다른 채권만 미수 집계 (이 예약 채권은 아직 미생성)
  const others = await tx.partnerReceivable.findMany({
    where: { partnerId: booking.partnerId, bookingId: { not: bookingId } },
    select: OPEN_OTHERS_SELECT,
  });

  const total = booking.totalSaleVnd ?? 0n;
  const depositDue = computeDepositDue(total, booking.partner.depositRatePct);
  const gate = canCreateBookingFor({
    tier: booking.partner.creditTier,
    status: booking.partner.status,
    creditLimitVnd: booking.partner.creditLimitVnd,
    currentOutstandingVnd: outstandingForPartner(others),
    overdue: hasOverdue(others, now),
    newCreditVnd: creditPortionVnd(total, depositDue),
  });
  return { allowed: gate.allowed, reason: gate.reason, skipped: false };
}

/**
 * 예약의 PartnerReceivable 보장(멱등) — 파트너 연결 + VND 객실료 + 미생성일 때만 생성.
 * 생성된 채권 또는 null(비대상·이미 존재) 반환.
 */
export async function ensureReceivableForBooking(tx: Tx, bookingId: string, now: Date) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      partnerId: true,
      totalSaleVnd: true,
      checkIn: true,
      partner: {
        select: { creditTier: true, depositRatePct: true, paymentTermDays: true },
      },
      receivable: { select: { id: true } },
    },
  });
  if (!booking?.partnerId || !booking.partner) return null;
  if (booking.receivable) return null; // 멱등
  if (booking.totalSaleVnd == null) return null; // B2B는 VND 객실료만

  const total = booking.totalSaleVnd;
  return tx.partnerReceivable.create({
    data: {
      partnerId: booking.partnerId,
      bookingId,
      totalVnd: total,
      depositDueVnd: computeDepositDue(total, booking.partner.depositRatePct),
      dueDate: computeDueDate({
        tier: booking.partner.creditTier,
        checkInDate: booking.checkIn,
        paymentTermDays: booking.partner.paymentTermDays,
      }),
      status: ReceivableStatus.PENDING,
    },
  });
}
