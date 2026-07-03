import {
  BookingStatus,
  NotificationType,
  PrismaClient,
  ReceivableStatus,
  type Booking,
  type Currency,
} from "@prisma/client";
import {
  checkAvailability,
  lockVillaInventory,
  OCCUPYING_BOOKING_STATUSES,
  type StayRange,
} from "./availability";
import { assertSaleAmountColumns, krwToVndSnapshot, quoteStayForVilla } from "./pricing";
import { writeAuditLog } from "./audit-log";
import { countNights } from "./hold";
import { computeDepositDue, computeDueDate } from "./partner";

/**
 * 예약 변경(Booking Modify) 핵심 로직 — 기존 예약의 날짜·빌라·인원·투숙객·조식 변경.
 *
 * 설계 원칙(CLAUDE.md / 계약):
 * - 상태 게이트: HOLD·CONFIRMED는 전 필드 변경, CHECKED_IN은 checkOut(체류 연장/단축)만,
 *   그 외(CHECKED_OUT·CANCELLED·EXPIRED·NO_SHOW)는 변경 불가.
 * - saleCurrency·channel은 이번 범위 밖 — 변경 입력에 없으며 절대 건드리지 않는다(통화 잠금).
 * - 동시성: 대상 빌라 재고 잠금(lockVillaInventory) + 자기 예약 제외 가용성 재검증 +
 *   booking.update는 updateMany + 기존 status 가드(cron 만료·동시 조작 경합 방지).
 * - 금액: 날짜/빌라가 바뀌면 quoteStayForVilla로 서버 재계산(saleCurrency 유지).
 *   환율 스냅샷(fxVndPerKrw)은 유지한다(재계산하지 않음 — 계약).
 * - 파트너 채권: 채권이 이미 있는데 금액(totalSaleVnd) 또는 빌라가 바뀌면 거부(취소 후 재예약 안내).
 * - 마진 비공개(원칙2): 공급자 알림 payload에 판매가·마진·원가 절대 미포함.
 * - AuditLog 필수: old→new 변경 필드 기록.
 */

/** 변경 거부 사유 — route가 HTTP로 매핑(권한은 route 책임) */
export type BookingModifyRejectReason =
  | "BOOKING_NOT_FOUND"
  | "STATUS_NOT_MODIFIABLE" // 종결·변경 불가 상태 (CHECKED_OUT/CANCELLED/EXPIRED/NO_SHOW)
  | "CHECKED_IN_FIELD_LOCKED" // CHECKED_IN인데 checkOut 외 필드를 바꾸려 함 (빌라·체크인일·인원 등)
  | "NO_CHANGES" // 변경할 필드가 없음
  | "INVALID_RANGE" // checkIn >= checkOut
  | "INVALID_GUEST_COUNT" // 인원수 < 1
  | "SOLD_OUT" // 자기 예약 제외 후에도 겹침/판매불가 (대상 빌라·기간)
  | "OVER_CAPACITY" // 인원 > 대상 빌라 정원(maxGuests) (ADR-0030 T-A)
  | "RECEIVABLE_EXISTS" // 파트너 채권 존재 + 금액/빌라 변경 → 취소 후 재예약 안내
  | "CONCURRENT_MODIFICATION"; // status 가드 실패 (그 사이 상태 전이)

export class BookingModifyRejectedError extends Error {
  constructor(
    public readonly reason: BookingModifyRejectReason,
    detail?: string
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "BookingModifyRejectedError";
  }
}

/** 변경 가능 필드만 받는다 — saleCurrency·channel은 의도적으로 제외(범위 밖·잠금). */
export interface ModifyBookingInput {
  bookingId: string;
  actorUserId: string;
  now: Date;
  /** YYYY-MM-DD 입력은 route에서 parseUtcDateOnly로 UTC 자정 Date 변환 후 전달 */
  checkIn?: Date;
  checkOut?: Date;
  villaId?: string;
  guestName?: string;
  guestCount?: number;
  guestPhone?: string | null;
  breakfastIncluded?: boolean;
  /** 변경 사유 — AuditLog 기록용(선택) */
  reason?: string;
}

/** 변경 결과 — route가 직렬화(BigInt→string)해 응답. 판매가 노출 여부는 route(canViewFinance)가 결정. */
export interface ModifyBookingResult {
  booking: Booking;
  /** 실제로 바뀐 필드명 목록 (UI 토스트·로그용) */
  changedFields: string[];
  /** 금액 재계산 여부 (날짜·빌라 변경 시 true) */
  recalculated: boolean;
  /** 과수납 여부 — 기수납(VND 환산) > 새 총액(VND 환산) (ADR-0030 T-D). 산출 불가 시 false */
  overpayment: boolean;
}

/** 상태별 변경 가능성 판정 (순수) — CHECKED_IN은 checkOut만 허용. */
export type ModifiableKind = "FULL" | "CHECKOUT_ONLY" | "NONE";

export function modifiableKind(status: BookingStatus): ModifiableKind {
  if (status === BookingStatus.HOLD || status === BookingStatus.CONFIRMED) return "FULL";
  if (status === BookingStatus.CHECKED_IN) return "CHECKOUT_ONLY";
  return "NONE"; // CHECKED_OUT·CANCELLED·EXPIRED·NO_SHOW
}

/**
 * 변경 입력에서 "checkOut 외 필드"를 건드렸는지 판정(순수) — CHECKED_IN 게이트용.
 * villaId·checkIn·guestName·guestCount·guestPhone·breakfastIncluded 중 하나라도 주어지면 true.
 * (checkOut만 변경하는 체류 연장/단축은 허용)
 */
export function touchesNonCheckoutFields(input: ModifyBookingInput): boolean {
  return (
    input.villaId !== undefined ||
    input.checkIn !== undefined ||
    input.guestName !== undefined ||
    input.guestCount !== undefined ||
    input.guestPhone !== undefined ||
    input.breakfastIncluded !== undefined
  );
}

/** [start, end) 자기 예약을 제외한 점유 겹침 수 where (availability bookingOverlapWhere와 동일 패턴 + id 제외) */
function selfExcludedOverlapWhere(villaId: string, range: StayRange, excludeBookingId: string) {
  return {
    villaId,
    id: { not: excludeBookingId }, // ★ 자기 예약 제외 — 변경은 자기 구간과 항상 겹치므로
    status: { in: [...OCCUPYING_BOOKING_STATUSES] },
    checkIn: { lt: range.checkOut },
    checkOut: { gt: range.checkIn },
  };
}

/** null-안전 max — 하한(floor) 적용용 (한쪽 null이면 다른 쪽) */
function maxNullableNum(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
function maxNullableBig(a: bigint | null, b: bigint | null): bigint | null {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}

/** 상태별 금액 결정에 쓰는 금액 3종 (판매가 KRW·VND, 원가 VND) */
export interface StayAmounts {
  totalSaleKrw: number | null;
  totalSaleVnd: bigint | null;
  supplierCostVnd: bigint;
}

/**
 * 상태별 금액 결정 (ADR-0030 D2/T-C) — 순수.
 * - CHECKED_IN: 이미 묵는 중이므로 **최초 확정액을 하한(floor)으로 유지**. 재견적이 크면(연장) 그 값을,
 *   작으면(단축·다운그레이드) 기존액을 유지 → **감액 없음**. 판매가·원가 모두 하한 적용.
 *   ⚠ nights는 실제 구간을 반영(별도) — 단축 시 nights는 줄지만 총액은 유지(무환불 정책)라
 *   nights×요율 ≠ 총액이 될 수 있으며, 이는 "무환불 합의액"의 의도된 표현이다.
 * - 그 외(CONFIRMED 등 아직 투숙 전): 전체 재견적 그대로(올려도 내려도 됨).
 */
export function resolveModifiedTotals(
  status: BookingStatus,
  existing: StayAmounts,
  quoted: StayAmounts
): StayAmounts {
  if (status === BookingStatus.CHECKED_IN) {
    return {
      totalSaleKrw: maxNullableNum(existing.totalSaleKrw, quoted.totalSaleKrw),
      totalSaleVnd: maxNullableBig(existing.totalSaleVnd, quoted.totalSaleVnd),
      supplierCostVnd:
        existing.supplierCostVnd > quoted.supplierCostVnd
          ? existing.supplierCostVnd
          : quoted.supplierCostVnd,
    };
  }
  return quoted;
}

/**
 * 예약 변경 — 단일 트랜잭션.
 * @throws BookingModifyRejectedError(reason) / RangeError(잘못된 입력)
 */
export async function modifyBooking(
  prisma: PrismaClient,
  input: ModifyBookingInput
): Promise<ModifyBookingResult> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: {
        villa: { select: { supplierId: true } },
        receivable: {
          select: {
            id: true,
            invoiceId: true, // 발행 청구서에 묶인 채권은 금액 변경 불가(ADR-0027)
            depositPaidVnd: true,
            balancePaidVnd: true,
          },
        },
        partner: { select: { creditTier: true, paymentTermDays: true, depositRatePct: true } },
        payments: { select: { vndEquivalent: true } }, // T-D 과수납 판정용
      },
    });
    if (!booking) throw new BookingModifyRejectedError("BOOKING_NOT_FOUND");

    // ── (a) 상태 게이트 ──
    const kind = modifiableKind(booking.status);
    if (kind === "NONE") {
      throw new BookingModifyRejectedError("STATUS_NOT_MODIFIABLE", booking.status);
    }
    if (kind === "CHECKOUT_ONLY" && touchesNonCheckoutFields(input)) {
      // CHECKED_IN: 빌라·체크인일·통화·인원 등 잠금. checkOut만 허용.
      throw new BookingModifyRejectedError("CHECKED_IN_FIELD_LOCKED");
    }

    // ── 변경 후 값 결정 (미지정 필드는 기존값 유지) ──
    const nextVillaId = input.villaId ?? booking.villaId;
    const nextCheckIn = input.checkIn ?? booking.checkIn;
    const nextCheckOut = input.checkOut ?? booking.checkOut;
    const range: StayRange = { checkIn: nextCheckIn, checkOut: nextCheckOut };

    // 구간 유효성 (checkIn < checkOut)
    if (!(range.checkIn.getTime() < range.checkOut.getTime())) {
      throw new BookingModifyRejectedError("INVALID_RANGE");
    }
    if (input.guestCount !== undefined) {
      if (!Number.isInteger(input.guestCount) || input.guestCount < 1) {
        throw new BookingModifyRejectedError("INVALID_GUEST_COUNT", String(input.guestCount));
      }
    }

    // ── 실제로 바뀌는 필드 판정 (값 동일하면 변경 아님) ──
    const villaChanged = nextVillaId !== booking.villaId;
    const checkInChanged = nextCheckIn.getTime() !== booking.checkIn.getTime();
    const checkOutChanged = nextCheckOut.getTime() !== booking.checkOut.getTime();
    const dateChanged = checkInChanged || checkOutChanged;
    const guestNameChanged =
      input.guestName !== undefined && input.guestName.trim() !== booking.guestName;
    const guestCountChanged =
      input.guestCount !== undefined && input.guestCount !== booking.guestCount;
    const guestPhoneChanged =
      input.guestPhone !== undefined &&
      (input.guestPhone?.trim() || null) !== booking.guestPhone;
    const breakfastChanged =
      input.breakfastIncluded !== undefined &&
      input.breakfastIncluded !== booking.breakfastIncluded;

    const changedFields: string[] = [];
    if (villaChanged) changedFields.push("villaId");
    if (checkInChanged) changedFields.push("checkIn");
    if (checkOutChanged) changedFields.push("checkOut");
    if (guestNameChanged) changedFields.push("guestName");
    if (guestCountChanged) changedFields.push("guestCount");
    if (guestPhoneChanged) changedFields.push("guestPhone");
    if (breakfastChanged) changedFields.push("breakfastIncluded");

    if (changedFields.length === 0) {
      throw new BookingModifyRejectedError("NO_CHANGES");
    }

    // ── (b0) 정원 검증 (ADR-0030 T-A) ──
    // 인원 또는 빌라가 바뀌면 대상(변경 후) 빌라의 정원(maxGuests)을 확인한다.
    // D0: 체크인 후 인원 변경은 위 CHECKED_IN_FIELD_LOCKED에서 이미 차단 — 여기 도달하는 인원 변경은
    //     확정(FULL) 상태뿐. 빌라 변경은 대상 빌라 정원에 현재 인원이 맞는지 확인.
    const nextGuestCount = input.guestCount ?? booking.guestCount;
    if (villaChanged || guestCountChanged) {
      const capVilla = await tx.villa.findUnique({
        where: { id: nextVillaId },
        select: { maxGuests: true },
      });
      if (capVilla && nextGuestCount > capVilla.maxGuests) {
        throw new BookingModifyRejectedError(
          "OVER_CAPACITY",
          `${nextGuestCount}/${capVilla.maxGuests}`
        );
      }
    }

    // ── (b) 재고 잠금 + 자기 예약 제외 가용성 ──
    // 빌라·날짜가 바뀔 때만 재검증(인원·이름·조식만 바뀌면 재고 영향 없음).
    const needsAvailabilityCheck = villaChanged || dateChanged;
    if (needsAvailabilityCheck) {
      // 대상(변경 후) 빌라 재고 잠금 — HOLD 생성·차단·iCal과 동일 키로 경합 직렬화.
      await lockVillaInventory(tx, nextVillaId);

      // checkAvailability는 bookingId 제외를 모르므로: 1) 점유 외 사유(VILLA_NOT_ACTIVE·
      // NOT_SELLABLE·BLOCK_OVERLAP)는 그대로 보고, 2) BOOKING_OVERLAP은 자기 예약을 제외한
      // 별도 count로 정확 판정한다.
      const [availability, otherOverlapCount] = await Promise.all([
        checkAvailability(tx, nextVillaId, range),
        tx.booking.count({
          where: selfExcludedOverlapWhere(nextVillaId, range, booking.id),
        }),
      ]);

      // 판매 가능 = villa ACTIVE + isSellable + 차단 없음 + (자기 제외) 다른 예약 겹침 없음.
      const blockedByOthers = otherOverlapCount > 0;
      const blockedByNonBooking =
        availability.reasons.some(
          (r) => r === "VILLA_NOT_ACTIVE" || r === "BLOCK_OVERLAP" || r === "NOT_SELLABLE"
        );
      if (blockedByOthers || blockedByNonBooking) {
        const reasons = [
          ...availability.reasons.filter((r) => r !== "BOOKING_OVERLAP"),
          ...(blockedByOthers ? ["BOOKING_OVERLAP"] : []),
        ];
        throw new BookingModifyRejectedError("SOLD_OUT", reasons.join(","));
      }
    }

    // ── (c) 금액 재계산 (날짜·빌라 변경 시) — saleCurrency 유지, 환율 스냅샷 유지 ──
    const saleCurrency: Currency = booking.saleCurrency;
    let nextNights = booking.nights;
    let nextTotalSaleKrw = booking.totalSaleKrw;
    let nextTotalSaleVnd = booking.totalSaleVnd;
    let nextSupplierCostVnd = booking.supplierCostVnd;
    const recalculated = villaChanged || dateChanged;
    if (recalculated) {
      // ADR-0031: 예약의 채널로 견적 계층 유지 — DIRECT면 소비자가, 여행사·랜드사면 Net.
      const quote = await quoteStayForVilla(tx, nextVillaId, range, saleCurrency, booking.channel);
      nextNights = countNights(range); // 실제 구간 반영(단축 시 감소) — 총액은 하한(아래)
      // ADR-0030 D2/T-C: 체크인 후엔 최초액을 하한으로 유지(감액 없음), 확정은 전체 재견적.
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
      nextTotalSaleKrw = resolved.totalSaleKrw;
      nextTotalSaleVnd = resolved.totalSaleVnd;
      nextSupplierCostVnd = resolved.supplierCostVnd;
      // 듀얼 컬럼 정합 — saleCurrency에 맞는 통화만 채워졌는지 검증
      assertSaleAmountColumns(saleCurrency, {
        krw: nextTotalSaleKrw,
        vnd: nextTotalSaleVnd,
      });
    }

    // ── (d) 파트너 채권 정합성 ──
    // 채권이 있을 때: 빌라 변경은 거부(분할=extend 경로). 금액은 — **같은 빌라 연장 증액**이면
    // 거부 대신 채권을 늘려준다(ADR-0030 §11: "여신 손님 같은 빌라 하루 더" = 돈 받고 연장).
    // 단 ① 발행 청구서에 묶인 채권(invoiceId)은 불변 ② 감액은 거부(정산 복잡·D2로 체크인 후엔 발생 안 함).
    let receivableIncrease = false; // (d-1)에서 채권 totalVnd 갱신
    if (booking.receivable) {
      const receivableAmountChanged =
        recalculated && (nextTotalSaleVnd ?? null) !== (booking.totalSaleVnd ?? null);
      if (villaChanged) {
        throw new BookingModifyRejectedError("RECEIVABLE_EXISTS", "villa");
      }
      if (receivableAmountChanged) {
        const increased = (nextTotalSaleVnd ?? 0n) > (booking.totalSaleVnd ?? 0n);
        if (!increased) {
          throw new BookingModifyRejectedError("RECEIVABLE_EXISTS", "amount_decrease");
        }
        if (booking.receivable.invoiceId) {
          throw new BookingModifyRejectedError("RECEIVABLE_EXISTS", "invoiced");
        }
        receivableIncrease = true; // 같은 빌라 연장 증액 + 미발행 → 채권 갱신 허용
      }
    }

    // ── (e) 갱신 — updateMany + 기존 status 가드로 동시성 (cron 만료·동시 조작 경합) ──
    const data: Record<string, unknown> = {};
    if (villaChanged) data.villaId = nextVillaId;
    if (checkInChanged) data.checkIn = nextCheckIn;
    if (checkOutChanged) data.checkOut = nextCheckOut;
    if (recalculated) {
      data.nights = nextNights;
      data.totalSaleKrw = nextTotalSaleKrw;
      data.totalSaleVnd = nextTotalSaleVnd;
      data.supplierCostVnd = nextSupplierCostVnd;
    }
    if (guestNameChanged) data.guestName = input.guestName!.trim();
    if (guestCountChanged) data.guestCount = input.guestCount;
    if (guestPhoneChanged) data.guestPhone = input.guestPhone?.trim() || null;
    if (breakfastChanged) data.breakfastIncluded = input.breakfastIncluded;

    const guarded = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status }, // 그 사이 상태 전이됐으면 0건
      data,
    });
    if (guarded.count !== 1) {
      throw new BookingModifyRejectedError("CONCURRENT_MODIFICATION");
    }
    const updated = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });

    // ── (d-1) 채권 증액 반영 (ADR-0030 §11) ──
    // 같은 빌라 연장으로 미수(채권)가 늘면 채권 totalVnd·선금기준·상태를 갱신한다(취소·재예약 없이 증액).
    // 미발행 채권만(위 d에서 invoiceId 있으면 이미 거부). 정산은 CONFIRMED/PAID(=CHECKED_OUT) 변경불가라 비해당.
    let receivableTotalChange: { old: string; new: string } | null = null;
    if (receivableIncrease && booking.receivable && booking.partner && nextTotalSaleVnd != null) {
      const totalPaid = booking.receivable.depositPaidVnd + booking.receivable.balancePaidVnd;
      const status =
        totalPaid >= nextTotalSaleVnd
          ? ReceivableStatus.PAID
          : totalPaid > 0n
            ? ReceivableStatus.PARTIAL
            : ReceivableStatus.PENDING;
      await tx.partnerReceivable.update({
        where: { id: booking.receivable.id },
        data: {
          totalVnd: nextTotalSaleVnd,
          depositDueVnd: computeDepositDue(nextTotalSaleVnd, booking.partner.depositRatePct),
          status,
        },
      });
      receivableTotalChange = {
        old: (booking.totalSaleVnd ?? 0n).toString(),
        new: nextTotalSaleVnd.toString(),
      };
    }

    // ── (d-2) 채권 dueDate 재산정 — 체크인일이 바뀌면 갱신 ──
    // computeDueDate는 checkIn 기반(등급A=체크인일, 등급B=체크인일+termDays)이므로
    // checkOut만 바뀐 경우엔 dueDate 불변. 빌라 변경·감액·발행분은 위 (d)에서 거부됨.
    let receivableDueDateChange: { old: string; new: string } | null = null;
    if (booking.receivable && booking.partner && checkInChanged) {
      const newDueDate = computeDueDate({
        tier: booking.partner.creditTier,
        checkInDate: nextCheckIn,
        paymentTermDays: booking.partner.paymentTermDays,
      });
      const cur = await tx.partnerReceivable.findUnique({
        where: { id: booking.receivable.id },
        select: { dueDate: true },
      });
      if (cur && cur.dueDate.getTime() !== newDueDate.getTime()) {
        await tx.partnerReceivable.update({
          where: { id: booking.receivable.id },
          data: { dueDate: newDueDate },
        });
        receivableDueDateChange = {
          old: cur.dueDate.toISOString().slice(0, 10),
          new: newDueDate.toISOString().slice(0, 10),
        };
      }
    }

    // ── (e-2) 과수납 판정 (ADR-0030 T-D) ──
    // 기수납(VND 환산 합계) > 새 총액(VND 환산)이면 과수납. 하드 차단은 하지 않고(운영자 판단)
    // 결과 플래그 + AuditLog로 남긴다 — 저장 전 경고는 미리보기(T-B)가 담당. VND/KRW만(USD 범위 밖).
    const collectedVnd = booking.payments.reduce<bigint | null>((sum, p) => {
      if (p.vndEquivalent == null) return sum;
      return (sum ?? 0n) + p.vndEquivalent;
    }, null);
    let newTotalVnd: bigint | null = null;
    if (saleCurrency === "VND") newTotalVnd = nextTotalSaleVnd ?? 0n;
    else if (saleCurrency === "KRW" && booking.fxVndPerKrw)
      newTotalVnd = krwToVndSnapshot(nextTotalSaleKrw ?? 0, booking.fxVndPerKrw.toString());
    const overpayment = collectedVnd != null && newTotalVnd != null && collectedVnd > newTotalVnd;

    // ── (f) AuditLog — old→new 변경 필드 (글로벌 절대규칙) ──
    const changes: Record<string, { old?: unknown; new?: unknown }> = {};
    if (villaChanged) changes.villaId = { old: booking.villaId, new: nextVillaId };
    if (checkInChanged) {
      changes.checkIn = {
        old: booking.checkIn.toISOString().slice(0, 10),
        new: nextCheckIn.toISOString().slice(0, 10),
      };
    }
    if (checkOutChanged) {
      changes.checkOut = {
        old: booking.checkOut.toISOString().slice(0, 10),
        new: nextCheckOut.toISOString().slice(0, 10),
      };
    }
    if (recalculated) changes.nights = { old: booking.nights, new: nextNights };
    if (guestNameChanged) changes.guestName = { old: booking.guestName, new: input.guestName!.trim() };
    if (guestCountChanged) changes.guestCount = { old: booking.guestCount, new: input.guestCount };
    if (guestPhoneChanged) {
      changes.guestPhone = { old: booking.guestPhone, new: input.guestPhone?.trim() || null };
    }
    if (breakfastChanged) {
      changes.breakfastIncluded = { old: booking.breakfastIncluded, new: input.breakfastIncluded };
    }
    if (receivableTotalChange) changes.receivableTotalVnd = receivableTotalChange;
    if (receivableDueDateChange) changes.receivableDueDate = receivableDueDateChange;
    if (overpayment) {
      changes.overpayment = {
        old: collectedVnd?.toString() ?? null, // 기수납(VND 환산)
        new: newTotalVnd?.toString() ?? null, // 새 총액(VND 환산) — 이보다 많이 받음
      };
    }
    if (input.reason?.trim()) changes.reason = { new: input.reason.trim() };

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "Booking",
      entityId: booking.id,
      changes,
    });

    // ── (g) 공급자 알림 큐 — 판매가·마진·원가 절대 미포함 (마진 비공개 원칙2) ──
    // 빌라가 바뀌면 새 빌라명, 아니면 기존 빌라명. 비민감 정보만(날짜·인원).
    const notifyVilla = await tx.villa.findUnique({
      where: { id: nextVillaId },
      select: { supplierId: true, name: true },
    });
    if (notifyVilla) {
      await tx.notification.create({
        data: {
          userId: notifyVilla.supplierId,
          type: NotificationType.BOOKING_MODIFIED,
          payload: {
            bookingId: booking.id,
            villaId: nextVillaId,
            villaName: notifyVilla.name,
            checkIn: nextCheckIn.toISOString().slice(0, 10),
            checkOut: nextCheckOut.toISOString().slice(0, 10),
            guestCount: updated.guestCount,
            changedFields, // 필드명만 — 금액 값 미포함
          },
        },
      });
    }

    return { booking: updated, changedFields, recalculated, overpayment };
  });
}
