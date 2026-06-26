import {
  CreditTier,
  ReceivableStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  canCreateBookingFor,
  computeDepositDue,
  computeDueDate,
  hasOverdue,
  outstandingForPartner,
  type CreditGateReason,
} from "@/lib/partner";
import { todayInVillaTimezone } from "@/lib/timeline";

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
 * 입금 1건 삭제(정정)를 채권에서 되돌림(순수) — applyPaymentToReceivable의 역연산.
 * 선금/잔금 누적분을 차감(0 하한) 후 상태 재계산. (OVERDUE는 cron이 기한 기준 별도 처리)
 * 결제 삭제 경로(app/api/payments/[id])에서 채권 카운터 정합성 유지에 사용.
 */
export function reversePaymentFromReceivable(
  rcv: { totalVnd: bigint; depositPaidVnd: bigint; balancePaidVnd: bigint },
  purpose: "DEPOSIT" | "BALANCE",
  vndAmount: bigint
): ReceivablePaidUpdate {
  const sub = vndAmount > 0n ? vndAmount : 0n;
  const max0 = (v: bigint) => (v > 0n ? v : 0n);
  const depositPaidVnd =
    purpose === "DEPOSIT" ? max0(rcv.depositPaidVnd - sub) : rcv.depositPaidVnd;
  const balancePaidVnd =
    purpose === "BALANCE" ? max0(rcv.balancePaidVnd - sub) : rcv.balancePaidVnd;
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

/** cron — prisma 또는 트랜잭션 클라이언트(partnerReceivable.updateMany 사용) */
type ReceivableUpdater = Pick<PrismaClient, "partnerReceivable"> | Tx;

/**
 * 연체 전이(cron) — 기한 경과한 미입금(PENDING/PARTIAL) 채권을 OVERDUE로.
 * PAID/WRITTEN_OFF는 제외(완납·대손). PENDING/PARTIAL은 항상 미입금 잔액>0이므로
 * dueDate < 오늘(VN 자정)이면 연체. 멱등(이미 OVERDUE는 where에서 제외). count 반환.
 * ★ "오늘"은 VN 캘린더 일(todayInVillaTimezone) — dueDate가 VN 날짜를 UTC 자정에 저장하므로
 *   UTC 일로 계산하면 cron이 17:00~23:59 UTC(다음 VN일 새벽)에 돌 때 하루 늦게 연체 전이됨.
 *   roster-reminder와 동일 규약.
 */
export async function markOverdueReceivables(
  db: ReceivableUpdater,
  asOf: Date
): Promise<number> {
  const today = todayInVillaTimezone(asOf);
  const res = await db.partnerReceivable.updateMany({
    where: {
      status: { in: [ReceivableStatus.PENDING, ReceivableStatus.PARTIAL] },
      dueDate: { lt: today },
    },
    data: { status: ReceivableStatus.OVERDUE },
  });
  return res.count;
}
