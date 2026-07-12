import {
  BookingChannel,
  BookingSeller,
  BookingStatus,
  Currency,
  NotificationType,
  PrismaClient,
  VillaStatus,
  type Booking,
} from "@prisma/client";
import {
  checkAvailability,
  countOverlapReasons,
  lockVillaInventory,
  type StayRange,
} from "./availability";
import { countNights } from "./hold";
import {
  assertSaleAmountColumns,
  getFxVndPerKrw,
  MissingRateError,
  quoteStayForVilla,
} from "./pricing";
import { getDailyRates } from "./fx-rates";
import { evaluateConfirmCredit, ensureReceivableForBooking } from "./partner-booking";
import { writeAuditLog } from "./audit-log";
import { toDateOnlyString } from "./date-vn";
import { notifyPartner } from "./partner-notify";

/**
 * 관리자 수동 예약 생성 (admin-manual-booking) — 단일 소스
 *
 * 운영자(테오)가 전화·Zalo로 직접 받은 예약을, 제안 링크 우회 없이 대시보드에서 바로 기록한다.
 * 기존 예약 4경로(제안 가예약·홀드 확정·공급자 직접·연장)와 동일한 재고 불변식을 재사용:
 *   lockVillaInventory + checkAvailability 트랜잭션이 "먼저 잡은 쪽이 임자"를 강제(더블부킹 방어).
 *
 * 핵심 원칙(절대 위반 금지):
 * - 검수 게이트 유지(사업원칙 3): 공급자 직접예약(ADR-0021 D4)과 달리 **isSellable 우회 없음**.
 *   운영자 재판매이므로 청소 검수 통과(isSellable=true) 빌라만 예약 가능.
 * - 판매가 스냅샷: 운영자가 협의한 총액을 saleCurrency 해당 통화 컬럼에만 저장(ADR-0003, float 금지).
 * - 원가·환율 스냅샷: quoteStayForVilla 박별 원가 + 생성 시점 환율(요율·환율 변경 무영향).
 * - 마진 비공개(사업원칙 2): 공급자 알림 payload에 판매가·마진·원가 절대 미포함.
 * - CONFIRMED + 파트너: confirmHold와 동일 규칙 — 여신 게이트(evaluateConfirmCredit) +
 *   채권 생성(ensureReceivableForBooking) 재사용.
 */

/** 관리자 예약 생성 거부 사유 — 라우트에서 상태코드 매핑용 */
export type AdminBookingRejectReason =
  | "VILLA_NOT_FOUND" // 빌라 없음
  | "NOT_SELLABLE" // villa.status != ACTIVE 또는 isSellable=false (검수 게이트)
  | "OVER_CAPACITY" // guestCount > 빌라 정원(maxGuests)
  | "SOLD_OUT" // 점유(예약·차단) 겹침 — 선착순 패배
  | "RATE_NOT_SET" // 요율 미설정으로 원가 스냅샷 불가
  | "PARTNER_CREDIT_BLOCKED"; // 파트너 여신 차단(BLOCKED·SUSPENDED·OVERDUE·LIMIT_EXCEEDED)

export class AdminBookingRejectedError extends Error {
  constructor(
    public readonly reason: AdminBookingRejectReason,
    detail?: string
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "AdminBookingRejectedError";
  }
}

export interface CreateAdminBookingInput {
  villaId: string;
  /** [checkIn, checkOut) — @db.Date UTC 자정 */
  range: StayRange;
  guestName: string;
  guestCount: number;
  guestPhone?: string | null;
  channel: BookingChannel;
  /** 여행사·랜드사 파트너 연결(선택). DIRECT 채널에는 지정 불가 */
  partnerId?: string | null;
  /** 파트너 미승격 텍스트(dual-read 폴백). DIRECT면 무시하고 null 저장 */
  agencyName?: string | null;
  saleCurrency: Currency;
  /** 운영자 협의 총액 — saleCurrency에 해당하는 컬럼만 채운다(양수). 나머지는 null */
  totalSaleKrw?: number | null;
  totalSaleVnd?: bigint | null;
  totalSaleUsd?: number | null;
  breakfastIncluded?: boolean;
  /** HOLD(가예약, holdExpiresAt 필수) 또는 CONFIRMED(확정) */
  status: BookingStatus;
  /** status=HOLD면 필수 — 미래 시각. cron(expireHolds)이 자동 만료 처리 */
  holdExpiresAt?: Date | null;
  /** 관리자 userId — AuditLog·여신 판정 actor */
  actorUserId: string;
  now: Date;
}

/**
 * 관리자 수동 예약 생성 — 단일 트랜잭션: 빌라 잠금 → 검수 게이트·정원·가용성 재검증 →
 * 원가·환율 스냅샷 → 예약 생성 → (확정+파트너면) 여신 게이트·채권 → 공급자 알림 → 감사로그.
 * 실패 시 AdminBookingRejectedError(reason) 또는 입력 오류는 RangeError.
 */
export async function createAdminBooking(
  prisma: PrismaClient,
  input: CreateAdminBookingInput
): Promise<Booking> {
  // ── 입력 검증 (트랜잭션 밖) ──
  if (!input.guestName.trim()) throw new RangeError("고객명은 필수입니다");
  if (!Number.isInteger(input.guestCount) || input.guestCount < 1) {
    throw new RangeError(`인원수가 잘못되었습니다: ${input.guestCount}`);
  }
  if (input.status !== BookingStatus.HOLD && input.status !== BookingStatus.CONFIRMED) {
    throw new RangeError(`허용되지 않는 상태입니다: ${input.status} (HOLD·CONFIRMED만)`);
  }
  // countNights가 checkIn < checkOut 검증을 겸한다 (0박·역전 거부)
  const nights = countNights(input.range);

  const isHold = input.status === BookingStatus.HOLD;
  if (isHold) {
    if (!input.holdExpiresAt) throw new RangeError("가예약(HOLD)은 만료시각(holdExpiresAt)이 필수입니다");
    if (input.holdExpiresAt.getTime() <= input.now.getTime()) {
      throw new RangeError("가예약 만료시각은 미래여야 합니다");
    }
  }

  // 판매가 컬럼 정합 — saleCurrency 해당 통화만 채우고 나머지는 비운다 (ADR-0003, Phase 2 USD 포함)
  assertSaleAmountColumns(input.saleCurrency, {
    krw: input.totalSaleKrw,
    vnd: input.totalSaleVnd,
    usd: input.totalSaleUsd,
  });
  // 협의 총액은 양수 — 운영자 수동입력 0/음수 방지
  const saleAmountPositive =
    input.saleCurrency === Currency.KRW
      ? (input.totalSaleKrw ?? 0) > 0
      : input.saleCurrency === Currency.USD
        ? (input.totalSaleUsd ?? 0) > 0
        : (input.totalSaleVnd ?? 0n) > 0n;
  if (!saleAmountPositive) throw new RangeError("판매 총액은 0보다 커야 합니다");

  // DIRECT 채널엔 파트너 비허용(일반 소비자). agencyName은 DIRECT면 저장하지 않음.
  if (input.partnerId && input.channel === BookingChannel.DIRECT) {
    throw new RangeError("직접(일반 소비자) 채널에는 파트너를 연결할 수 없습니다");
  }
  const agencyName =
    input.channel === BookingChannel.DIRECT ? null : (input.agencyName?.trim() || null);

  // USD 환율 스냅샷은 외부 API fetch(getDailyRates)가 따를 수 있어 트랜잭션 밖에서 미리 조회
  //   (트랜잭션 점유 시간 최소화 — 제안 생성 경로와 동일). null/USD rate 없으면 null.
  let fxVndPerUsd: string | null = null;
  if (input.saleCurrency === Currency.USD) {
    const rates = await getDailyRates(prisma, input.now);
    const usdRate = rates?.vndPerUnit?.USD;
    if (usdRate && usdRate > 0) fxVndPerUsd = usdRate.toFixed(4);
  }

  const result = await prisma.$transaction(async (tx) => {
    // 재고 경합 공통 잠금 — 제안 가예약·공급자 직접·CalendarBlock·iCal과 동일 락 키 (선착순 보장)
    await lockVillaInventory(tx, input.villaId);

    const villa = await tx.villa.findUnique({
      where: { id: input.villaId },
      select: {
        id: true,
        name: true,
        status: true,
        isSellable: true,
        maxGuests: true,
        supplierId: true,
      },
    });
    if (!villa) throw new AdminBookingRejectedError("VILLA_NOT_FOUND");

    // 검수 게이트 유지 — 운영자 재판매는 ACTIVE + isSellable(청소 검수 통과) 필수 (사업원칙 3, 우회 없음)
    if (villa.status !== VillaStatus.ACTIVE || !villa.isSellable) {
      throw new AdminBookingRejectedError(
        "NOT_SELLABLE",
        `status=${villa.status} isSellable=${villa.isSellable}`
      );
    }

    // 정원 검증 (ADR-0030 D0과 동일 기준)
    if (input.guestCount > villa.maxGuests) {
      throw new AdminBookingRejectedError(
        "OVER_CAPACITY",
        `정원 ${villa.maxGuests}명 초과: ${input.guestCount}명`
      );
    }

    // 가용성 재검증 — 점유(예약·차단 겹침)면 거부. isSellable은 위에서 이미 확인.
    const availability = await checkAvailability(tx, villa.id, input.range);
    if (countOverlapReasons(availability.reasons) > 0) {
      throw new AdminBookingRejectedError("SOLD_OUT", availability.reasons.join(","));
    }

    // 파트너 연결 검증(선택) — 존재·유형 일치 (제안 생성 경로와 동일 규칙)
    if (input.partnerId) {
      const partner = await tx.partner.findUnique({
        where: { id: input.partnerId },
        select: { type: true },
      });
      if (!partner) throw new RangeError("존재하지 않는 파트너입니다");
      if ((partner.type as string) !== (input.channel as string)) {
        throw new RangeError("파트너 유형이 판매 채널과 일치하지 않습니다");
      }
    }

    // 원가 = 박별 원가 합산 스냅샷 (요율 변경 무영향). 채널 전달 — 원가는 계층 무관 동일값.
    //   요율 미설정 빌라는 견적 불가 → RATE_NOT_SET (운영자가 먼저 요율 설정 필요).
    let supplierCostVnd: bigint;
    try {
      const quote = await quoteStayForVilla(
        tx,
        villa.id,
        input.range,
        input.saleCurrency,
        input.channel
      );
      supplierCostVnd = quote.totalSupplierCostVnd;
    } catch (e) {
      if (e instanceof MissingRateError) {
        throw new AdminBookingRejectedError("RATE_NOT_SET", e.message);
      }
      throw e;
    }

    // 생성 시점 KRW 환율 스냅샷 (제안 생성 경로와 동일 — getFxVndPerKrw, 미설정이면 null)
    const fxVndPerKrw = await getFxVndPerKrw(tx);

    const booking = await tx.booking.create({
      data: {
        villaId: villa.id,
        status: input.status, // HOLD 또는 CONFIRMED — 직접 최종 상태로 생성
        seller: BookingSeller.OPERATOR, // 운영자 판매 고정
        channel: input.channel,
        checkIn: input.range.checkIn,
        checkOut: input.range.checkOut,
        nights,
        guestName: input.guestName.trim(),
        guestCount: input.guestCount,
        guestPhone: input.guestPhone?.trim() || null,
        agencyName,
        partnerId: input.partnerId ?? null,
        holdExpiresAt: isHold ? input.holdExpiresAt : null,
        saleCurrency: input.saleCurrency,
        totalSaleKrw: input.totalSaleKrw ?? null,
        totalSaleVnd: input.totalSaleVnd ?? null,
        totalSaleUsd: input.totalSaleUsd ?? null,
        fxVndPerKrw,
        fxVndPerUsd,
        supplierCostVnd,
        breakfastIncluded: input.breakfastIncluded ?? false,
      },
    });

    // 확정 + 파트너: confirmHold와 동일 규칙 — 여신 게이트 후 채권 생성(멱등).
    //   HOLD거나 파트너 미연결이면 skip (여신·채권 무관).
    if (input.status === BookingStatus.CONFIRMED && input.partnerId) {
      const credit = await evaluateConfirmCredit(tx, booking.id, input.now);
      if (!credit.allowed) {
        throw new AdminBookingRejectedError(
          "PARTNER_CREDIT_BLOCKED",
          credit.reason ?? "LIMIT_EXCEEDED"
        );
      }
      await ensureReceivableForBooking(tx, booking.id, input.now);
    }

    // 공급자 알림 큐 — 판매가·마진·원가 절대 미포함(마진 비공개). 실발송은 T3.5 Zalo cron.
    //   HOLD → BOOKING_HOLD, CONFIRMED → BOOKING_CONFIRMED (기존 경로 payload 스키마 동일).
    if (isHold) {
      await tx.notification.create({
        data: {
          userId: villa.supplierId,
          type: NotificationType.BOOKING_HOLD,
          payload: {
            bookingId: booking.id,
            villaId: villa.id,
            villaName: villa.name,
            checkIn: toDateOnlyString(input.range.checkIn),
            checkOut: toDateOnlyString(input.range.checkOut),
            guestCount: input.guestCount,
            guestName: input.guestName.trim(), // 손님맞이 준비용(판매가·마진 아님)
            holdExpiresAt: input.holdExpiresAt!.toISOString(),
          },
        },
      });
    } else {
      await tx.notification.create({
        data: {
          userId: villa.supplierId,
          type: NotificationType.BOOKING_CONFIRMED,
          payload: {
            bookingId: booking.id,
            villaId: villa.id,
            villaName: villa.name,
            checkIn: toDateOnlyString(input.range.checkIn),
            checkOut: toDateOnlyString(input.range.checkOut),
            guestCount: input.guestCount,
            guestName: input.guestName.trim(),
            breakfastIncluded: booking.breakfastIncluded, // true일 때만 문구 표기
          },
        },
      });
    }

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "CREATE",
      entity: "Booking",
      entityId: booking.id,
      changes: {
        source: { new: "ADMIN_MANUAL" }, // 수동 예약 식별 (제안·공급자 직접과 구분)
        status: { new: input.status },
        seller: { new: BookingSeller.OPERATOR },
        channel: { new: input.channel },
        ...(input.partnerId ? { partnerId: { new: input.partnerId } } : {}),
        ...(isHold ? { holdExpiresAt: { new: input.holdExpiresAt!.toISOString() } } : {}),
      },
    });

    return { booking, villaName: villa.name };
  });

  // 확정 파트너 예약이면 파트너에게도 통지 — 커밋 후(외부 Zalo 포함), 실패 무해(내부 격리).
  //   객실료 총액·잔금 기한(파트너 본인 채권)만. 마진·원가·KRW 미포함 (confirmHold와 동일).
  if (input.status === BookingStatus.CONFIRMED && result.booking.partnerId) {
    const receivable = await prisma.partnerReceivable
      .findUnique({
        where: { bookingId: result.booking.id },
        select: { totalVnd: true, dueDate: true },
      })
      .catch(() => null);
    await notifyPartner(result.booking.partnerId, {
      kind: "BOOKING_CONFIRMED",
      bookingId: result.booking.id,
      villaName: result.villaName,
      checkIn: toDateOnlyString(result.booking.checkIn),
      checkOut: toDateOnlyString(result.booking.checkOut),
      totalVnd: receivable ? receivable.totalVnd.toString() : null,
      dueDate: receivable ? receivable.dueDate.toISOString().slice(0, 10) : null,
    });
  }

  return result.booking;
}
