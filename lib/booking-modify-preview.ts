import {
  BookingStatus,
  PrismaClient,
  type Currency,
} from "@prisma/client";
import {
  checkAvailability,
  OCCUPYING_BOOKING_STATUSES,
  type StayRange,
} from "./availability";
import { krwToVndSnapshot, quoteStayForVilla } from "./pricing";
import { countNights } from "./hold";
import {
  modifiableKind,
  resolveModifiedTotals,
  type BookingModifyRejectReason,
} from "./booking-modify";

/**
 * 예약 변경 미리보기(dry-run) — 커밋 없이 결과를 계산해 반환 (ADR-0030 T-B).
 *
 * modifyBooking과 **동일한 판정·견적 코어**(modifiableKind·checkAvailability·quoteStayForVilla·
 * resolveModifiedTotals)를 재사용하되 **쓰기 없음**(잠금·update·알림·감사 없음). 운영자가 저장 전에
 * "추가청구·새 총액·정원·공실·과수납"을 확인하는 용도.
 *
 * ⚠ 재무 게이트: 반환의 판매가·추가청구·수납·환산액은 route(canViewFinance)가 STAFF에 제거한다.
 * ⚠ 자문형: 트랜잭션 잠금 없이 읽으므로 실제 커밋 시점의 경합은 modifyBooking이 최종 판정한다.
 */

/** 미리보기 입력 — 금액·정원·가용성에 영향을 주는 필드만 (이름·전화·조식 제외) */
export interface ModifyPreviewInput {
  bookingId: string;
  checkIn?: Date;
  checkOut?: Date;
  villaId?: string;
  guestCount?: number;
}

export interface ModifyPreview {
  /** 변경 가능 여부 — blockers 비어 있으면 true */
  ok: boolean;
  /** 변경 차단 사유(있으면) — UI 안내용 */
  blockers: BookingModifyRejectReason[];
  status: BookingStatus;
  /** 금액 재계산 여부 (빌라·날짜 변경 시) */
  recalculated: boolean;
  saleCurrency: Currency;
  nightsOld: number;
  nightsNew: number;
  capacityOk: boolean;
  availabilityOk: boolean;
  // ── 재무 게이트(canViewFinance) ──
  existingSaleKrw: number | null;
  existingSaleVnd: bigint | null;
  newSaleKrw: number | null;
  newSaleVnd: bigint | null;
  /** 추가청구 = new − existing (음수=감액, CONFIRMED 다운그레이드) */
  additionalKrw: number | null;
  additionalVnd: bigint | null;
  /** 기수납액(VND 환산 합계). 환율 미상이면 null */
  collectedVnd: bigint | null;
  /** 새 총액의 VND 환산. 환율 미상이면 null */
  newTotalVnd: bigint | null;
  /** 과수납 — 기수납 > 새 총액 (T-D 경고). 산출 불가 시 false */
  overpayment: boolean;
}

export async function previewBookingModify(
  prisma: PrismaClient,
  input: ModifyPreviewInput
): Promise<ModifyPreview> {
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      status: true,
      villaId: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      guestCount: true,
      saleCurrency: true,
      totalSaleKrw: true,
      totalSaleVnd: true,
      supplierCostVnd: true,
      fxVndPerKrw: true,
      receivable: { select: { id: true, invoiceId: true } },
      payments: { select: { vndEquivalent: true } },
    },
  });
  if (!booking) throw new Error("BOOKING_NOT_FOUND");

  const blockers: BookingModifyRejectReason[] = [];

  const nextVillaId = input.villaId ?? booking.villaId;
  const nextCheckIn = input.checkIn ?? booking.checkIn;
  const nextCheckOut = input.checkOut ?? booking.checkOut;
  const nextGuestCount = input.guestCount ?? booking.guestCount;
  const range: StayRange = { checkIn: nextCheckIn, checkOut: nextCheckOut };

  const villaChanged = nextVillaId !== booking.villaId;
  const checkInChanged = nextCheckIn.getTime() !== booking.checkIn.getTime();
  const checkOutChanged = nextCheckOut.getTime() !== booking.checkOut.getTime();
  const dateChanged = checkInChanged || checkOutChanged;
  const guestCountChanged =
    input.guestCount !== undefined && input.guestCount !== booking.guestCount;

  // 상태 게이트 (modifyBooking과 동일 규칙)
  const kind = modifiableKind(booking.status);
  if (kind === "NONE") blockers.push("STATUS_NOT_MODIFIABLE");
  // CHECKED_IN: checkOut 외 필드(빌라·체크인일·인원)를 건드리면 잠김 (D0 인원 포함)
  if (kind === "CHECKOUT_ONLY" && (villaChanged || checkInChanged || guestCountChanged)) {
    blockers.push("CHECKED_IN_FIELD_LOCKED");
  }
  if (!(range.checkIn.getTime() < range.checkOut.getTime())) blockers.push("INVALID_RANGE");
  if (input.guestCount !== undefined && (!Number.isInteger(input.guestCount) || input.guestCount < 1)) {
    blockers.push("INVALID_GUEST_COUNT");
  }

  // 정원 검증 (T-A와 동일) — 빌라·인원 변경 시
  let capacityOk = true;
  if (villaChanged || guestCountChanged) {
    const capVilla = await prisma.villa.findUnique({
      where: { id: nextVillaId },
      select: { maxGuests: true },
    });
    if (capVilla && nextGuestCount > capVilla.maxGuests) {
      capacityOk = false;
      blockers.push("OVER_CAPACITY");
    }
  }

  // 가용성 (빌라·날짜 변경 시, 자기 예약 제외)
  let availabilityOk = true;
  const rangeValid = range.checkIn.getTime() < range.checkOut.getTime();
  if ((villaChanged || dateChanged) && rangeValid) {
    const [availability, otherOverlap] = await Promise.all([
      checkAvailability(prisma, nextVillaId, range),
      prisma.booking.count({
        where: {
          villaId: nextVillaId,
          id: { not: booking.id },
          status: { in: [...OCCUPYING_BOOKING_STATUSES] },
          checkIn: { lt: range.checkOut },
          checkOut: { gt: range.checkIn },
        },
      }),
    ]);
    const blockedByNonBooking = availability.reasons.some(
      (r) => r === "VILLA_NOT_ACTIVE" || r === "BLOCK_OVERLAP" || r === "NOT_SELLABLE"
    );
    if (otherOverlap > 0 || blockedByNonBooking) {
      availabilityOk = false;
      blockers.push("SOLD_OUT");
    }
  }

  // 금액 재계산 (빌라·날짜 변경 시) + 상태별 하한 (T-C)
  const recalculated = (villaChanged || dateChanged) && rangeValid;
  let newSaleKrw = booking.totalSaleKrw;
  let newSaleVnd = booking.totalSaleVnd;
  let nightsNew = booking.nights;
  if (recalculated) {
    const quote = await quoteStayForVilla(prisma, nextVillaId, range, booking.saleCurrency);
    nightsNew = countNights(range);
    const resolved = resolveModifiedTotals(
      booking.status,
      {
        totalSaleKrw: booking.totalSaleKrw,
        totalSaleVnd: booking.totalSaleVnd,
        supplierCostVnd: booking.supplierCostVnd,
      },
      {
        totalSaleKrw: quote.totalSaleKrw ?? null,
        totalSaleVnd: quote.totalSaleVnd ?? null,
        supplierCostVnd: quote.totalSupplierCostVnd,
      }
    );
    newSaleKrw = resolved.totalSaleKrw;
    newSaleVnd = resolved.totalSaleVnd;
  }

  // 파트너 채권 정합(modify와 동일 규칙, ADR-0030 §11): 빌라 변경·감액·발행분은 차단,
  // 같은 빌라 증액(연장)은 허용(채권 증액). 미리보기가 저장 결과를 정확히 반영.
  if (booking.receivable) {
    if (villaChanged) {
      blockers.push("RECEIVABLE_EXISTS");
    } else if (
      recalculated &&
      newSaleVnd != null &&
      booking.totalSaleVnd != null &&
      newSaleVnd !== booking.totalSaleVnd
    ) {
      const increased = newSaleVnd > booking.totalSaleVnd;
      if (!increased || booking.receivable.invoiceId) blockers.push("RECEIVABLE_EXISTS");
    }
  }

  // 추가청구 = new − existing (통화별)
  const additionalKrw =
    newSaleKrw != null && booking.totalSaleKrw != null ? newSaleKrw - booking.totalSaleKrw : null;
  const additionalVnd =
    newSaleVnd != null && booking.totalSaleVnd != null ? newSaleVnd - booking.totalSaleVnd : null;

  // 수납·과수납 (T-D) — 새 총액을 VND 환산해 기수납 합계와 비교
  const collectedVnd = booking.payments.reduce<bigint | null>((sum, p) => {
    if (p.vndEquivalent == null) return sum;
    return (sum ?? 0n) + p.vndEquivalent;
  }, null);
  const newTotalVnd = saleTotalToVnd(
    booking.saleCurrency,
    newSaleKrw,
    newSaleVnd,
    booking.fxVndPerKrw ? booking.fxVndPerKrw.toString() : null
  );
  const overpayment =
    collectedVnd != null && newTotalVnd != null && collectedVnd > newTotalVnd;

  return {
    ok: blockers.length === 0,
    blockers,
    status: booking.status,
    recalculated,
    saleCurrency: booking.saleCurrency,
    nightsOld: booking.nights,
    nightsNew,
    capacityOk,
    availabilityOk,
    existingSaleKrw: booking.totalSaleKrw,
    existingSaleVnd: booking.totalSaleVnd,
    newSaleKrw,
    newSaleVnd,
    additionalKrw,
    additionalVnd,
    collectedVnd,
    newTotalVnd,
    overpayment,
  };
}

/** 판매 총액 → VND 환산 (VND는 그대로, KRW는 스냅샷 환율, 환율 미상이면 null). USD는 modify 범위 밖. */
function saleTotalToVnd(
  saleCurrency: Currency,
  totalSaleKrw: number | null,
  totalSaleVnd: bigint | null,
  fxVndPerKrw: string | null
): bigint | null {
  if (saleCurrency === "VND") return totalSaleVnd ?? 0n;
  if (saleCurrency === "KRW") {
    if (!fxVndPerKrw) return null;
    return krwToVndSnapshot(totalSaleKrw ?? 0, fxVndPerKrw);
  }
  return null;
}
