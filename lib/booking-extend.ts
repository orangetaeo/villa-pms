import {
  BookingStatus,
  NotificationType,
  PrismaClient,
  type Booking,
} from "@prisma/client";
import {
  checkAvailability,
  lockVillaInventory,
  OCCUPYING_BOOKING_STATUSES,
  type StayRange,
} from "./availability";
import { assertSaleAmountColumns, quoteStayForVilla } from "./pricing";
import { countNights } from "./hold";
import { writeAuditLog } from "./audit-log";
import { ensureReceivableForBooking } from "./partner-booking";

/**
 * 분할 숙박 — 연결된 추가(연장) 예약 생성 (ADR-0030 D1/T-E).
 *
 * 체크인 후 연장인데 원 빌라가 그 기간 이미 예약돼서 **다른 빌라로 이어 묵어야** 할 때,
 * 추가 밤을 대체 빌라의 **새 Booking**으로 만들고 원(부모) 예약과 `parentBookingId`로 잇는다.
 * 각 예약은 여전히 단일 빌라 — 세그먼트 모델 대신 연결 예약(대공사 회피).
 *
 * 원칙:
 * - 대체 빌라는 공실 + 정원 충족 + isSellable(청소 게이트) 만 (checkAvailability + guestCount).
 * - 새 예약은 신선한 밤이므로 **전체 견적**(하한 규칙은 부모의 기존 밤에만 적용 — 여기선 불필요).
 * - 부모에서 상속: 게스트·통화·채널·seller·조식·환율 스냅샷·partnerId.
 * - 파트너 채권(D3/T-F): 부모에 partnerId가 있으면 자식도 자기 채권(ensureReceivableForBooking)을
 *   만든다 → 마감 청구서 생성이 파트너·기간별로 채권을 묶으므로 **자동으로 청구서 추가라인**이 된다
 *   (부모 예약 자체는 변경 없음 → RECEIVABLE_EXISTS 미발생). 취소·재예약 아님. VND 객실료만(모델 제약).
 *   ⚠ 연장은 신용 게이트로 하드 차단하지 않는다(D3 — 청구로 흡수, 이미 확정·투숙 중인 파트너).
 * - 마진 비공개: 새 빌라 공급자 알림엔 판매가·마진 미포함(BOOKING_CONFIRMED = villaName·날짜·인원만).
 */

export type CreateExtensionRejectReason =
  | "PARENT_NOT_FOUND"
  | "PARENT_NOT_EXTENDABLE" // 부모가 CONFIRMED·CHECKED_IN이 아님 (활성 예약만 연장)
  | "INVALID_RANGE" // checkIn >= checkOut
  | "SAME_VILLA" // 대체 빌라가 부모와 동일 — 같은 빌라 연장은 modify(체크아웃일)로
  | "SOLD_OUT" // 대체 빌라·기간 판매 불가(점유·차단·미검수)
  | "OVER_CAPACITY"; // 인원 > 대체 빌라 정원

export class CreateExtensionRejectedError extends Error {
  constructor(
    public readonly reason: CreateExtensionRejectReason,
    detail?: string
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "CreateExtensionRejectedError";
  }
}

export interface CreateExtensionInput {
  parentBookingId: string;
  /** 대체(연장) 빌라 — 부모와 달라야 함 */
  villaId: string;
  /** 연장 구간 (YYYY-MM-DD → UTC 자정은 route가 변환) */
  checkIn: Date;
  checkOut: Date;
  actorUserId: string;
  now: Date;
}

export interface CreateExtensionResult {
  booking: Booking;
}

export async function createLinkedExtensionBooking(
  prisma: PrismaClient,
  input: CreateExtensionInput
): Promise<CreateExtensionResult> {
  const range: StayRange = { checkIn: input.checkIn, checkOut: input.checkOut };
  if (!(range.checkIn.getTime() < range.checkOut.getTime())) {
    throw new CreateExtensionRejectedError("INVALID_RANGE");
  }

  return prisma.$transaction(async (tx) => {
    const parent = await tx.booking.findUnique({
      where: { id: input.parentBookingId },
      select: {
        id: true,
        status: true,
        villaId: true,
        channel: true,
        seller: true,
        guestName: true,
        guestCount: true,
        guestPhone: true,
        breakfastIncluded: true,
        saleCurrency: true,
        fxVndPerKrw: true,
        fxVndPerUsd: true,
        partnerId: true,
      },
    });
    if (!parent) throw new CreateExtensionRejectedError("PARENT_NOT_FOUND");

    // 활성 예약만 연장 — CONFIRMED(확정)·CHECKED_IN(투숙 중)
    if (
      parent.status !== BookingStatus.CONFIRMED &&
      parent.status !== BookingStatus.CHECKED_IN
    ) {
      throw new CreateExtensionRejectedError("PARENT_NOT_EXTENDABLE", parent.status);
    }
    // 같은 빌라 연장은 modify(체크아웃일)로 — 연결 예약은 "다른 빌라"에만
    if (input.villaId === parent.villaId) {
      throw new CreateExtensionRejectedError("SAME_VILLA");
    }

    // 대체 빌라 재고 잠금 + 가용성 + 정원 (부모 인원 기준)
    await lockVillaInventory(tx, input.villaId);
    const availability = await checkAvailability(tx, input.villaId, range, parent.guestCount);
    if (availability.reasons.includes("OVER_CAPACITY")) {
      throw new CreateExtensionRejectedError("OVER_CAPACITY");
    }
    if (!availability.sellable) {
      throw new CreateExtensionRejectedError("SOLD_OUT", availability.reasons.join(","));
    }

    // 전체 견적(신선한 밤) — 부모 통화 유지
    const quote = await quoteStayForVilla(tx, input.villaId, range, parent.saleCurrency);
    const totalSaleKrw = quote.totalSaleKrw ?? null;
    const totalSaleVnd = quote.totalSaleVnd ?? null;
    assertSaleAmountColumns(parent.saleCurrency, { krw: totalSaleKrw, vnd: totalSaleVnd });

    const child = await tx.booking.create({
      data: {
        villaId: input.villaId,
        parentBookingId: parent.id, // ★ 연결
        status: BookingStatus.CONFIRMED, // 게스트가 실제 이동하면 개별 체크인/아웃
        channel: parent.channel,
        seller: parent.seller,
        checkIn: range.checkIn,
        checkOut: range.checkOut,
        nights: countNights(range),
        guestName: parent.guestName,
        guestCount: parent.guestCount,
        guestPhone: parent.guestPhone,
        breakfastIncluded: parent.breakfastIncluded,
        saleCurrency: parent.saleCurrency,
        totalSaleKrw,
        totalSaleVnd,
        supplierCostVnd: quote.totalSupplierCostVnd,
        // 환율 스냅샷 상속(정산 정합)
        fxVndPerKrw: parent.fxVndPerKrw,
        fxVndPerUsd: parent.fxVndPerUsd,
        partnerId: parent.partnerId,
      },
    });

    // 파트너 채권(D3/T-F) — 자식 예약도 자기 채권 생성 → 마감 청구서에 추가라인으로 묶임.
    // ensureReceivableForBooking: 멱등·VND 객실료만·partner 없으면 no-op. 신용 하드게이트 없음(D3).
    if (parent.partnerId) {
      await ensureReceivableForBooking(tx, child.id, input.now);
    }

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "CREATE",
      entity: "Booking",
      entityId: child.id,
      changes: {
        parentBookingId: { new: parent.id },
        villaId: { new: input.villaId },
        checkIn: { new: range.checkIn.toISOString().slice(0, 10) },
        checkOut: { new: range.checkOut.toISOString().slice(0, 10) },
        // BigInt는 Json 컬럼에 직접 못 들어감 — 문자열 (판매가는 canViewFinance UI에서만 표시)
        extensionOf: { new: parent.id },
      },
    });

    // 새 빌라 공급자 알림 — 판매가·마진 미포함(BOOKING_CONFIRMED = villaName·날짜·인원만)
    const notifyVilla = await tx.villa.findUnique({
      where: { id: input.villaId },
      select: { supplierId: true, name: true },
    });
    if (notifyVilla) {
      await tx.notification.create({
        data: {
          userId: notifyVilla.supplierId,
          type: NotificationType.BOOKING_CONFIRMED,
          payload: {
            bookingId: child.id,
            villaId: input.villaId,
            villaName: notifyVilla.name,
            checkIn: range.checkIn.toISOString().slice(0, 10),
            checkOut: range.checkOut.toISOString().slice(0, 10),
            guestCount: parent.guestCount,
          },
        },
      });
    }

    return { booking: child };
  });
}

/** 부모 예약의 연결 자식(연장) 예약 조회 — 상세 화면·정산 합산용 (마진 게이트는 호출부) */
export async function listExtensionBookings(
  prisma: PrismaClient,
  parentBookingId: string
) {
  return prisma.booking.findMany({
    where: {
      parentBookingId,
      status: { in: [...OCCUPYING_BOOKING_STATUSES, BookingStatus.CHECKED_OUT] },
    },
    orderBy: { checkIn: "asc" },
    select: {
      id: true,
      villaId: true,
      villa: { select: { name: true } },
      status: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      guestCount: true,
      saleCurrency: true,
      totalSaleKrw: true,
      totalSaleVnd: true,
    },
  });
}
