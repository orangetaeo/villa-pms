// B2C 계약금/잔금 스케줄 — DB 층 (ADR-0048 P3b). 순수 계산은 lib/b2c-payment.ts.
//   ensureB2cScheduleForBooking: confirmHold에서 B2B 채권(ensureReceivableForBooking)과 대칭으로 호출.
//   DIRECT(일반고객) 예약에만 스케줄 생성(멱등). 파트너·공급자 직판은 제외.
//   ⚠ 누수: 스케줄(VND 앵커·마진 판단 재료)은 canViewFinance 전용 — 공급자·공개·STAFF 경로 직렬화 금지.
import {
  Prisma,
  BookingChannel,
  BookingSeller,
  PaymentPurpose,
  B2cScheduleStatus,
  Currency,
  NotificationType,
} from "@prisma/client";
import type { DbClient } from "./availability";
import {
  buildB2cScheduleCreate,
  deriveB2cScheduleStatus,
  B2C_DEFAULT_DEPOSIT_RATE_PCT,
  B2C_DEFAULT_BALANCE_LEAD_DAYS,
} from "./b2c-payment";
import { getEffectiveFxVndPerKrw, getEffectiveFxVndPerUsd } from "./fx-effective";
import { suggestSalePriceKrw, suggestSalePriceUsd } from "./pricing";
import { enqueueOperatorNotification } from "./operator-notify";
import { resolveRefundPct, computeB2cRefund } from "./b2c-refund";

type Tx = Prisma.TransactionClient;

const MS_PER_DAY = 86_400_000;
const utcDateOnly = (d: Date) =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const DEPOSIT_RATE_KEY = "B2C_DEPOSIT_RATE_PCT";
const BALANCE_LEAD_KEY = "B2C_BALANCE_LEAD_DAYS";

/** AppSetting에서 B2C 정책값 읽기 (오염·미설정은 정책 기본값 폴백 — 서비스 중단 안 함, resolveHoldHours 관례). */
export async function resolveB2cSettings(
  db: DbClient
): Promise<{ depositRatePct: number; balanceLeadDays: number }> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: [DEPOSIT_RATE_KEY, BALANCE_LEAD_KEY] } },
    select: { key: true, value: true },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const rate = Number(get(DEPOSIT_RATE_KEY));
  const lead = Number(get(BALANCE_LEAD_KEY));
  return {
    depositRatePct:
      Number.isInteger(rate) && rate >= 0 && rate <= 100 ? rate : B2C_DEFAULT_DEPOSIT_RATE_PCT,
    balanceLeadDays:
      Number.isInteger(lead) && lead >= 0 && lead <= 365 ? lead : B2C_DEFAULT_BALANCE_LEAD_DAYS,
  };
}

/**
 * 예약 확정 시 B2C 계약금/잔금 스케줄 생성 (멱등). ensureReceivableForBooking(B2B)의 B2C 대칭.
 *  - 대상: channel=DIRECT & 파트너 미연결 & seller=OPERATOR(공급자 직판 F10 제외 — ADR-0021).
 *  - 이미 스케줄 있으면 skip(멱등). VND 앵커 산출 불가(환율 미설정 등)면 skip(생성 보류).
 * 반환: 생성된 스케줄 / 대상 아님·멱등·보류 시 null.
 */
export async function ensureB2cScheduleForBooking(tx: Tx, bookingId: string, now: Date) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      channel: true,
      seller: true,
      partnerId: true,
      saleCurrency: true,
      totalSaleKrw: true,
      totalSaleVnd: true,
      totalSaleUsd: true,
      fxVndPerKrw: true,
      fxVndPerUsd: true,
      checkIn: true,
      b2cSchedule: { select: { id: true } },
    },
  });
  if (!booking) return null;
  // B2C = 직접(일반고객) 채널 · 파트너 미연결 · 우리 판매(공급자 직판 제외)
  if (booking.channel !== BookingChannel.DIRECT) return null;
  if (booking.partnerId != null) return null;
  if (booking.seller !== BookingSeller.OPERATOR) return null;
  if (booking.b2cSchedule) return null; // 멱등

  const { depositRatePct, balanceLeadDays } = await resolveB2cSettings(tx);
  const data = buildB2cScheduleCreate({
    bookingId: booking.id,
    saleCurrency: booking.saleCurrency,
    totalSaleKrw: booking.totalSaleKrw,
    totalSaleVnd: booking.totalSaleVnd,
    totalSaleUsd: booking.totalSaleUsd,
    fxVndPerKrw: booking.fxVndPerKrw != null ? booking.fxVndPerKrw.toString() : null,
    fxVndPerUsd: booking.fxVndPerUsd != null ? booking.fxVndPerUsd.toString() : null,
    checkIn: booking.checkIn,
    now,
    depositRatePct,
    balanceLeadDays,
  });
  if (!data) return null; // 앵커 산출 불가 — 생성 보류(호출부는 무해하게 진행)

  return tx.b2cPaymentSchedule.create({
    data: {
      bookingId: data.bookingId,
      totalVnd: data.totalVnd,
      depositRatePct: data.depositRatePct,
      depositDueVnd: data.depositDueVnd,
      balanceDueVnd: data.balanceDueVnd,
      depositDueDate: data.depositDueDate,
      balanceDueDate: data.balanceDueDate,
      fullPrepay: data.fullPrepay,
    },
  });
}

/**
 * B2C 스케줄 상태 재계산 (P3b-2) — 계약금/잔금 Payment 소진 후 호출.
 *   예약의 B2C 결제(B2C_DEPOSIT/B2C_BALANCE) VND환산 누적을 집계해 PENDING→DEPOSIT_PAID→PAID로 전이.
 *   스케줄 없거나 이미 CANCELLED면 무변경. 상태가 실제 바뀔 때만 update.
 *   ⚠ 호출부는 payments 라우트의 예약 advisory lock(receivable:{bookingId}) 안에서 부르므로 경합 안전.
 */
export async function refreshB2cScheduleStatus(tx: Tx, bookingId: string) {
  const schedule = await tx.b2cPaymentSchedule.findUnique({
    where: { bookingId },
    select: { id: true, totalVnd: true, depositDueVnd: true, status: true },
  });
  if (!schedule) return null;
  if (schedule.status === B2cScheduleStatus.CANCELLED) return null; // 취소분은 결제로 되살리지 않음

  const sums = await tx.payment.groupBy({
    by: ["purpose"],
    where: { bookingId, purpose: { in: [PaymentPurpose.B2C_DEPOSIT, PaymentPurpose.B2C_BALANCE] } },
    _sum: { vndEquivalent: true },
  });
  const sumOf = (p: PaymentPurpose) =>
    sums.find((r) => r.purpose === p)?._sum.vndEquivalent ?? 0n;
  const depositPaidVnd = sumOf(PaymentPurpose.B2C_DEPOSIT);
  const balancePaidVnd = sumOf(PaymentPurpose.B2C_BALANCE);

  const next = deriveB2cScheduleStatus(schedule, depositPaidVnd, balancePaidVnd);
  if (next === schedule.status) return schedule; // 무변경 — 쓰기 스킵
  return tx.b2cPaymentSchedule.update({
    where: { id: schedule.id },
    data: { status: next },
  });
}

/**
 * B2C 예약 취소 시 스케줄 CANCELLED 전이 + 환불 계산 (ADR-0048 P6, cancelBooking에서 호출).
 *   환불율 = **동의 스냅샷(policyConsentJson.policy.tiers)의 취소규정** — 동의 당시 조건이 정본.
 *   스냅샷에 취소규정이 없으면(취소규정 disabled로 예약) 위약금 없음(100% 환불) 폴백.
 *   환불은 낸 통화·낸 금액 그대로(computeB2cRefund, LIFO). ★기록만 — 실제 송금은 외부(deposit 환불과 동일).
 * 반환: 감사 로그용 환불 요약 / B2C 아님·이미 취소면 null.
 */
export async function cancelB2cScheduleAndComputeRefund(tx: Tx, bookingId: string, now: Date) {
  const schedule = await tx.b2cPaymentSchedule.findUnique({
    where: { bookingId },
    select: {
      id: true,
      totalVnd: true,
      status: true,
      booking: { select: { checkIn: true, policyConsentJson: true } },
    },
  });
  if (!schedule || schedule.status === B2cScheduleStatus.CANCELLED) return null;

  const payments = await tx.payment.findMany({
    where: {
      bookingId,
      purpose: { in: [PaymentPurpose.B2C_DEPOSIT, PaymentPurpose.B2C_BALANCE] },
    },
    select: { id: true, currency: true, amount: true, vndEquivalent: true, receivedAt: true },
  });

  // 동의 당시 취소규정 tier가 정본. 없으면 위약금 없음(100%) 폴백.
  const consent = schedule.booking.policyConsentJson as {
    policy?: { tiers?: { fromDays: number; refundPct: number }[] };
  } | null;
  const tiers = consent?.policy?.tiers;
  const daysUntilCheckIn = Math.floor(
    (utcDateOnly(schedule.booking.checkIn) - utcDateOnly(now)) / MS_PER_DAY
  );
  const refundPct = tiers && tiers.length > 0 ? resolveRefundPct(tiers, daysUntilCheckIn) : 100;

  const refund = computeB2cRefund(
    schedule.totalVnd,
    refundPct,
    payments.map((p) => ({
      paymentId: p.id,
      currency: p.currency,
      amount: p.amount,
      vndEquivalent: p.vndEquivalent ?? 0n, // B2C 결제는 항상 세팅되나 방어적 0
      receivedAt: p.receivedAt,
    }))
  );

  await tx.b2cPaymentSchedule.update({
    where: { id: schedule.id },
    data: { status: B2cScheduleStatus.CANCELLED },
  });

  return refund;
}

/**
 * B2C 잔금 도래 운영자 알림 (ADR-0048 P4) — 체크인 D-14 도달 예약의 잔금 청구를 운영자(테오)에게 통지.
 *   대상: 스케줄 status=DEPOSIT_PAID(계약금 납부·잔금 대기) & 잔금>0 & balanceDueDate == 오늘.
 *   멱등: balanceDueDate 정확 매칭(1일 1회 크론 전제 — checkout-reminder 관례). 운영자는 예약 상세에서도 확인 가능.
 *   잔금 청구통화 추정액(현재 유효 환율)을 함께 안내 — ★실제 확정은 결제 시점 환율(ADR-0048). 마진·FX원본 미포함.
 */
export async function notifyB2cBalancesDue(db: DbClient, now: Date) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const due = await db.b2cPaymentSchedule.findMany({
    where: {
      status: B2cScheduleStatus.DEPOSIT_PAID,
      balanceDueVnd: { gt: 0n },
      balanceDueDate: today,
    },
    select: {
      balanceDueVnd: true,
      booking: {
        select: {
          id: true,
          saleCurrency: true,
          guestName: true,
          checkIn: true,
          villa: { select: { name: true } },
        },
      },
    },
  });
  if (due.length === 0) return { targetCount: 0, notificationCount: 0 };

  // 잔금 청구통화 추정액용 현재 유효 환율(1회 조회). VND 청구는 불필요.
  const fxKrw = await getEffectiveFxVndPerKrw(db);
  const fxUsd = await getEffectiveFxVndPerUsd(db);

  let notificationCount = 0;
  for (const s of due) {
    const b = s.booking;
    const cur = b.saleCurrency;
    let balanceBilledApprox: number | null = null;
    if (cur === Currency.KRW && fxKrw) balanceBilledApprox = suggestSalePriceKrw(s.balanceDueVnd, fxKrw);
    else if (cur === Currency.USD && fxUsd) balanceBilledApprox = suggestSalePriceUsd(s.balanceDueVnd, fxUsd);
    await enqueueOperatorNotification({
      type: NotificationType.B2C_BALANCE_DUE,
      db,
      payload: {
        bookingId: b.id,
        villaName: b.villa.name,
        guestName: b.guestName,
        checkIn: b.checkIn.toISOString().slice(0, 10),
        billingCurrency: cur,
        balanceDueVnd: s.balanceDueVnd.toString(),
        balanceBilledApprox, // 환율 미상이면 null → VND만 안내
      },
    });
    notificationCount++;
  }
  return { targetCount: due.length, notificationCount };
}
