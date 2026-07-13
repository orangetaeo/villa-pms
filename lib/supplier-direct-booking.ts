import {
  BookingChannel,
  BookingSeller,
  BookingStatus,
  Currency,
  NotificationType,
  Prisma,
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
import { writeAuditLog } from "./audit-log";
import { enqueueOperatorNotification } from "./operator-notify";
import { toDateOnlyString } from "./date-vn";

/**
 * 공급자 직접예약 (F10 Phase A, ADR-0021 §6) — 단일 소스
 *
 * 공급자가 전화·Zalo·워크인으로 자기 고객에게 판 것을 수동 기록한다.
 * 그 즉시 공실이 우리(운영자)에게 공유되어 선점 판단에 쓰인다.
 *
 * 핵심 원칙(절대 위반 금지):
 * - 선착순(D2): 기존 lockVillaInventory + checkAvailability 트랜잭션이 그대로
 *   "먼저 잡은 쪽이 임자"를 강제한다. 우선권 비교 로직 없음.
 * - 공급자 100%(D3): seller=SUPPLIER → 정산(F6) 제외. supplierCostVnd=0(우리가 매입 안 함).
 * - 마진·재고 비공개: 응답은 공급자 자기 정보만. 운영자 salePriceKrw·마진·타 공급자·전체 재고 0.
 *   선착순 패배(점유)는 사유 코드만 — 운영자 예약 상세·금액 절대 비노출.
 * - 검수 게이트 우회(D4): 직접판매 개시는 isSellable 게이트로 막지 않음(villa.status=ACTIVE만 요구).
 */

/** 직접예약 생성 거부 사유 — UI 안내 분기용(상세 비노출) */
export type SupplierDirectRejectReason =
  | "VILLA_NOT_FOUND" // 빌라 없음 또는 타 공급자 빌라 (소유권 스코프)
  | "VILLA_NOT_ACTIVE" // villa.status != ACTIVE
  | "OCCUPIED"; // 선착순 패배 — 운영자/타 예약·차단 겹침 (상세 비노출)

export class SupplierDirectRejectedError extends Error {
  constructor(
    public readonly reason: SupplierDirectRejectReason,
    detail?: string
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "SupplierDirectRejectedError";
  }
}

export interface CreateSupplierDirectBookingInput {
  villaId: string;
  /** 본인 supplierId — villa.supplierId === 이 값이 아니면 VILLA_NOT_FOUND (소유권 스코프) */
  supplierId: string;
  range: StayRange;
  guestName: string;
  guestCount: number;
  guestPhone?: string | null;
  /** 공급자가 자기 고객에게 받은 금액(VND, 동 단위) — 우리 회계 무관, 공급자 기록용 */
  supplierSalePriceVnd?: bigint | null;
}

/**
 * 공급자 직접예약 생성 — 단일 트랜잭션: 빌라 잠금 → 소유·ACTIVE 검증 → 가용성 재검증 → 생성.
 * 실패 시 SupplierDirectRejectedError(reason). 점유(OCCUPIED)는 상세 비노출.
 */
export async function createSupplierDirectBooking(
  prisma: PrismaClient,
  input: CreateSupplierDirectBookingInput
): Promise<Booking> {
  if (!input.guestName.trim()) throw new RangeError("고객명은 필수입니다");
  if (!Number.isInteger(input.guestCount) || input.guestCount < 1) {
    throw new RangeError(`인원수가 잘못되었습니다: ${input.guestCount}`);
  }
  // countNights 가 checkIn < checkOut 검증을 겸한다 (0박·역전 거부)
  const nights = countNights(input.range);

  return prisma.$transaction(async (tx) => {
    // 재고 경합 공통 잠금 — HOLD 생성·CalendarBlock 생성·iCal upsert와 동일 락 키 (선착순 보장)
    await lockVillaInventory(tx, input.villaId);

    // 소유권 스코프: 자기 빌라만. 타 공급자 빌라는 존재 여부도 비노출(VILLA_NOT_FOUND)
    const villa = await tx.villa.findFirst({
      where: { id: input.villaId, supplierId: input.supplierId },
      select: { id: true, name: true, status: true },
    });
    if (!villa) throw new SupplierDirectRejectedError("VILLA_NOT_FOUND");
    // D4: 검수 게이트(isSellable)는 우리 재판매만 막는다 — 직접판매는 ACTIVE만 요구
    if (villa.status !== VillaStatus.ACTIVE) {
      throw new SupplierDirectRejectedError("VILLA_NOT_ACTIVE");
    }

    // 가용성 재검증 — 점유(예약·차단 겹침)면 거부. isSellable(검수)은 의도적으로 무시(D4).
    const availability = await checkAvailability(tx, villa.id, input.range);
    if (countOverlapReasons(availability.reasons) > 0) {
      throw new SupplierDirectRejectedError("OCCUPIED", availability.reasons.join(","));
    }

    const booking = await tx.booking.create({
      data: {
        villaId: villa.id,
        seller: BookingSeller.SUPPLIER,
        status: BookingStatus.CONFIRMED, // 공급자가 이미 자기 고객 수금 완료 — HOLD 단계 생략
        channel: BookingChannel.DIRECT,
        checkIn: input.range.checkIn,
        checkOut: input.range.checkOut,
        nights,
        guestName: input.guestName.trim(),
        guestCount: input.guestCount,
        guestPhone: input.guestPhone?.trim() || null,
        saleCurrency: Currency.VND,
        // 공급자 직접판매: 우리 매입 없음 → 원가 0(스키마 NOT NULL). 정산은 seller 필터로 제외.
        supplierCostVnd: 0n,
        supplierSalePriceVnd: input.supplierSalePriceVnd ?? null,
      },
    });

    await writeAuditLog({
      db: tx,
      userId: input.supplierId,
      action: "CREATE",
      entity: "Booking",
      entityId: booking.id,
      // 변경 추적 — 직접예약 식별용. 판매가 금액은 감사로그에도 굳이 안 남김(공급자 사유).
      changes: {
        seller: { new: BookingSeller.SUPPLIER },
        status: { new: BookingStatus.CONFIRMED },
        channel: { new: BookingChannel.DIRECT },
        action: { new: "SUPPLIER_DIRECT_BOOKING_CREATE" },
      },
    });

    // 운영자 통지 — 선점 기회 인지(정보성). 판매가·마진 절대 미포함 (마진 비공개).
    // 공급자명·예약자명·예약번호 포함 — 운영자가 알림만으로 어느 공급자의 어떤 건인지 특정.
    const supplier = await tx.user.findUnique({
      where: { id: input.supplierId },
      select: { name: true },
    });
    await enqueueOperatorDirectBookingNotice(tx, {
      bookingId: booking.id,
      villaName: villa.name,
      supplierName: supplier?.name ?? null,
      guestName: input.guestName.trim(),
      checkIn: toDateOnlyString(input.range.checkIn),
      checkOut: toDateOnlyString(input.range.checkOut),
      guestCount: input.guestCount,
    });

    return booking;
  });
}

interface DirectBookingNoticePayload {
  bookingId: string;
  villaName: string;
  supplierName: string | null;
  guestName: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
}

/**
 * 공급자 직접예약 생성 시 운영자 통지 적재 — 그룹 설정 시 그룹방 1건, 미설정 시 개별 DM fan-out (ADR-0040).
 * 운영자 0명(미연결)이면 알림 0건이지만 정상(선점 통지는 정보성, 본 트랜잭션 깨지 않음).
 * payload에 판매가·마진·공급자 받은 금액 절대 미포함.
 */
async function enqueueOperatorDirectBookingNotice(
  db: Prisma.TransactionClient,
  payload: DirectBookingNoticePayload
): Promise<void> {
  await enqueueOperatorNotification({
    db,
    type: NotificationType.SUPPLIER_DIRECT_BOOKING,
    payload: {
      bookingId: payload.bookingId,
      villaName: payload.villaName,
      supplierName: payload.supplierName,
      guestName: payload.guestName,
      checkIn: payload.checkIn,
      checkOut: payload.checkOut,
      guestCount: payload.guestCount,
    },
  });
}
