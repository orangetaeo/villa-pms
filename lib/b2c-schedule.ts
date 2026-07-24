// B2C 계약금/잔금 스케줄 — DB 층 (ADR-0048 P3b). 순수 계산은 lib/b2c-payment.ts.
//   ensureB2cScheduleForBooking: confirmHold에서 B2B 채권(ensureReceivableForBooking)과 대칭으로 호출.
//   DIRECT(일반고객) 예약에만 스케줄 생성(멱등). 파트너·공급자 직판은 제외.
//   ⚠ 누수: 스케줄(VND 앵커·마진 판단 재료)은 canViewFinance 전용 — 공급자·공개·STAFF 경로 직렬화 금지.
import { Prisma, BookingChannel, BookingSeller } from "@prisma/client";
import {
  buildB2cScheduleCreate,
  B2C_DEFAULT_DEPOSIT_RATE_PCT,
  B2C_DEFAULT_BALANCE_LEAD_DAYS,
} from "./b2c-payment";

type Tx = Prisma.TransactionClient;

const DEPOSIT_RATE_KEY = "B2C_DEPOSIT_RATE_PCT";
const BALANCE_LEAD_KEY = "B2C_BALANCE_LEAD_DAYS";

/** AppSetting에서 B2C 정책값 읽기 (오염·미설정은 정책 기본값 폴백 — 서비스 중단 안 함, resolveHoldHours 관례). */
export async function resolveB2cSettings(
  tx: Tx
): Promise<{ depositRatePct: number; balanceLeadDays: number }> {
  const rows = await tx.appSetting.findMany({
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
