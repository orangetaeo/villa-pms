import {
  BookingSeller,
  BookingStatus,
  NotificationType,
  PrismaClient,
  ProposalStatus,
  type Booking,
} from "@prisma/client";
import {
  assertValidStayRange,
  checkAvailability,
  lockVillaInventory,
  type StayRange,
} from "./availability";
import { assertSaleAmountColumns, quoteStayForVilla } from "./pricing";
import { writeAuditLog } from "./audit-log";
import {
  ensureReceivableForBooking,
  evaluateConfirmCredit,
  writeOffReceivableOnCancel,
} from "./partner-booking";
import { autoClosePendingRequestsOnCancel } from "./booking-change-request";
import { vendorHasLivePo } from "./vendor-order";
import { buildVendorNotifText, enqueueInAppNotification } from "./inapp-notification";
import { toDateOnlyString } from "./date-vn";
import { notifyPartner } from "./partner-notify";

/**
 * HOLD(가예약) 수명주기 단일 소스 (SPEC F3 흐름 3~5)
 *
 * - 생성: /p/[token] "이 빌라로 가예약" 클릭 → 단일 트랜잭션(빌라 잠금 → 가용성
 *   재검증 → 스냅샷 생성). 재검증 실패 시 거부("마감되었습니다") — 더블부킹 최종 방어선
 * - 스냅샷: 판매가 = ProposalItem 복사(고객이 본 가격), 원가 = HOLD 시점 박별 합산,
 *   환율 = Proposal 복사. 이후 요율·환율 변경 무영향
 * - 만료: cron(5분)이 holdExpiresAt 경과 HOLD → EXPIRED, 재고 자동 복귀
 * - 알림: 공급자 Notification(PENDING) 큐 적재만 — 실발송은 T3.5 Zalo cron.
 *   payload에 판매가·마진 절대 미포함 (마진 비공개 원칙)
 */

const MS_PER_HOUR = 3_600_000;

/** AppSetting 키 — 홀드 기본 시간 (SPEC: 기본 48h, 제안 생성 시 24/48h 선택) */
export const HOLD_HOURS_DEFAULT_KEY = "HOLD_HOURS_DEFAULT";
export const DEFAULT_HOLD_HOURS = 48;
const MAX_HOLD_HOURS = 168; // 7일 — 운영 실수 방어 상한

/** HOLD 거부 사유 — /p/[token] 안내 분기용 */
export type HoldRejectReason =
  | "PROPOSAL_ITEM_NOT_FOUND"
  | "PROPOSAL_NOT_ACTIVE" // USED·EXPIRED·REVOKED
  | "PROPOSAL_EXPIRED" // expiresAt 경과 (status 갱신 전이라도 시각 기준 거부)
  | "ITEM_ALREADY_BOOKED"
  | "SOLD_OUT" // 가용성 재검증 실패 — "마감되었습니다"
  | "HOLD_EXPIRED" // 확정 시점에 이미 만료
  | "INVALID_STATUS" // 상태 전이 불가 (확정/취소)
  | "PARTNER_CREDIT_BLOCKED" // 파트너 여신 차단(한도초과·연체·BLOCKED·SUSPENDED, ADR-0022)
  | "OVER_CAPACITY"; // 인원이 빌라 정원(maxGuests) 초과 — 공개 가예약 검증 (consumer-bugs #1)

export class HoldRejectedError extends Error {
  constructor(
    public readonly reason: HoldRejectReason,
    detail?: string
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "HoldRejectedError";
  }
}

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/**
 * 홀드 시간 결정 — 우선순위: override(제안별 24/48h 선택) > AppSetting > 기본 48.
 * 1~168 정수만 허용 — 범위 밖·비정수 override는 RangeError, 설정값 오염은 기본값 폴백
 */
export function resolveHoldHours(
  settingValue: string | null | undefined,
  override?: number
): number {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 1 || override > MAX_HOLD_HOURS) {
      throw new RangeError(`홀드 시간은 1~${MAX_HOLD_HOURS} 정수여야 합니다: ${override}`);
    }
    return override;
  }
  if (settingValue != null) {
    const parsed = Number(settingValue);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_HOLD_HOURS) return parsed;
    // 설정값 오염은 서비스 중단 사유가 아님 — 기본값 폴백
  }
  return DEFAULT_HOLD_HOURS;
}

export function computeHoldExpiresAt(now: Date, holdHours: number): Date {
  return new Date(now.getTime() + holdHours * MS_PER_HOUR);
}

export interface ProposalForHoldInput {
  proposalStatus: ProposalStatus;
  proposalExpiresAt: Date;
  /** ProposalItem.bookingId — 이미 가예약된 item인지 */
  itemBookingId: string | null;
  now: Date;
}

/** 제안이 가예약 가능한 상태인지 순수 판정 — 거부 시 사유 반환 */
export function evaluateProposalForHold(
  input: ProposalForHoldInput
): HoldRejectReason | null {
  if (input.itemBookingId) return "ITEM_ALREADY_BOOKED";
  if (input.proposalStatus !== ProposalStatus.ACTIVE) return "PROPOSAL_NOT_ACTIVE";
  if (input.proposalExpiresAt.getTime() <= input.now.getTime()) return "PROPOSAL_EXPIRED";
  return null;
}

/** 박 수 — [checkIn, checkOut) UTC 자정 규약 */
export function countNights(range: StayRange): number {
  assertValidStayRange(range);
  return Math.round((range.checkOut.getTime() - range.checkIn.getTime()) / 86_400_000);
}

// ===================== DB 층 =====================

export interface CreateHoldInput {
  proposalItemId: string;
  guestName: string;
  guestCount: number;
  guestPhone?: string;
  /** 제안별 24/48h 선택 (T2.1에서 전달). 미지정 시 AppSetting → 48 */
  holdHours?: number;
  /** 비로그인 고객 액션이므로 null 허용 — AuditLog에는 시스템 기록 */
  actorUserId?: string | null;
  now: Date;
}

/**
 * 가예약 생성 — 단일 트랜잭션: 빌라 잠금 → 제안 검증 → 가용성 재검증 → 스냅샷 생성.
 * 실패 시 HoldRejectedError(reason) — /p/[token]에서 사유별 안내.
 */
export async function createHoldFromProposalItem(
  prisma: PrismaClient,
  input: CreateHoldInput
): Promise<Booking> {
  if (!input.guestName.trim()) throw new RangeError("고객명은 필수입니다");
  if (!Number.isInteger(input.guestCount) || input.guestCount < 1) {
    throw new RangeError(`인원수가 잘못되었습니다: ${input.guestCount}`);
  }

  return prisma.$transaction(async (tx) => {
    const item = await tx.proposalItem.findUnique({
      where: { id: input.proposalItemId },
      include: { proposal: true, villa: { select: { supplierId: true, name: true, maxGuests: true } } },
    });
    if (!item) throw new HoldRejectedError("PROPOSAL_ITEM_NOT_FOUND");

    // 재고 경합 쓰기 공통 잠금 — CalendarBlock 생성·iCal upsert와 동일 키
    await lockVillaInventory(tx, item.villaId);

    const rejectReason = evaluateProposalForHold({
      proposalStatus: item.proposal.status,
      proposalExpiresAt: item.proposal.expiresAt,
      itemBookingId: item.bookingId,
      now: input.now,
    });
    if (rejectReason) throw new HoldRejectedError(rejectReason);

    // 정원 검증 (consumer-bugs #1) — 공개 폼은 변조 가능하므로 서버가 최종 방어선.
    //   관리자 예약변경(ADR-0030 D0)과 동일 기준: 인원 > 정원이면 거부.
    if (input.guestCount > item.villa.maxGuests) {
      throw new HoldRejectedError(
        "OVER_CAPACITY",
        `정원 ${item.villa.maxGuests}명 초과: ${input.guestCount}명`
      );
    }

    const range: StayRange = { checkIn: item.checkIn, checkOut: item.checkOut };

    // 클릭 시점 가용성 재검증 — 제안 발송 후 iCal 차단 등으로 재고가 사라질 수 있음 (SPEC 엣지)
    const availability = await checkAvailability(tx, item.villaId, range);
    if (!availability.sellable) {
      throw new HoldRejectedError("SOLD_OUT", availability.reasons.join(","));
    }

    // 판매가 = 제안 스냅샷(고객이 본 가격) — 통화 컬럼 정합 검증 (Phase 2: USD 포함)
    const saleCurrency = item.proposal.saleCurrency;
    assertSaleAmountColumns(saleCurrency, {
      krw: item.totalKrw,
      vnd: item.totalVnd,
      usd: item.totalUsd,
    });

    const isSupplierSale = item.proposal.seller === BookingSeller.SUPPLIER;

    // 원가 = HOLD 시점 박별 합산 스냅샷 (요율 변경 무영향).
    // 공급자 직접판매(seller=SUPPLIER)는 우리 원가가 무의미(정산 제외, 공급자 100%)하므로
    // quoteStayForVilla(운영자 원가 견적)를 호출하지 않는다 — 운영자 요율·원가 비참조(F10 Phase B).
    const supplierCostVnd = isSupplierSale
      ? 0n
      : (await quoteStayForVilla(tx, item.villaId, range, saleCurrency)).totalSupplierCostVnd;

    const holdHoursSetting = await tx.appSetting.findUnique({
      where: { key: HOLD_HOURS_DEFAULT_KEY },
    });
    const holdHours = resolveHoldHours(holdHoursSetting?.value, input.holdHours);
    const holdExpiresAt = computeHoldExpiresAt(input.now, holdHours);

    const booking = await tx.booking.create({
      data: {
        villaId: item.villaId,
        status: BookingStatus.HOLD,
        channel: item.proposal.channel,
        seller: item.proposal.seller,
        checkIn: item.checkIn,
        checkOut: item.checkOut,
        nights: countNights(range),
        guestName: input.guestName.trim(),
        guestCount: input.guestCount,
        guestPhone: input.guestPhone?.trim() || null,
        agencyName: item.proposal.channel === "DIRECT" ? null : item.proposal.clientName,
        holdExpiresAt,
        saleCurrency,
        totalSaleKrw: item.totalKrw,
        totalSaleVnd: item.totalVnd,
        totalSaleUsd: item.totalUsd, // Phase 2 USD: 제안 스냅샷 복사
        fxVndPerKrw: item.proposal.fxVndPerKrw,
        fxVndPerUsd: item.proposal.fxVndPerUsd, // Phase 2 USD: 제안 환율 스냅샷 복사
        // 공급자 직접판매: 우리 원가는 null(스키마는 NOT NULL이라 0n) + 공급자가 받은 금액 기록
        supplierCostVnd,
        ...(isSupplierSale ? { supplierSalePriceVnd: item.totalVnd } : {}),
      },
    });

    await tx.proposalItem.update({
      where: { id: item.id },
      data: { bookingId: booking.id },
    });
    // 가예약 발생 → 제안 사용됨 (다른 item은 USED 상태로 비활성 렌더).
    // status 가드 필수: 빌라 락은 제안 레벨을 못 지킴 — 같은 제안의 다른 빌라 item을
    // 동시 가예약하면 서로 다른 락이라 둘 다 통과하므로, 여기서 ACTIVE→USED 원자 전환이
    // 두 번째 트랜잭션을 차단한다 (QA D-1)
    const used = await tx.proposal.updateMany({
      where: { id: item.proposalId, status: ProposalStatus.ACTIVE },
      data: { status: ProposalStatus.USED },
    });
    if (used.count !== 1) throw new HoldRejectedError("PROPOSAL_NOT_ACTIVE");

    // 공급자 알림 큐 — 판매가·마진 미포함 (마진 비공개), 실발송은 T3.5
    await tx.notification.create({
      data: {
        userId: item.villa.supplierId,
        type: NotificationType.BOOKING_HOLD,
        payload: {
          bookingId: booking.id,
          villaId: item.villaId,
          villaName: item.villa.name,
          checkIn: item.checkIn.toISOString().slice(0, 10),
          checkOut: item.checkOut.toISOString().slice(0, 10),
          guestCount: input.guestCount,
          guestName: input.guestName.trim(), // 예약자명 — 손님맞이 준비용(판매가·마진 아님)
          holdExpiresAt: holdExpiresAt.toISOString(),
        },
      },
    });

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId ?? null,
      action: "CREATE",
      entity: "Booking",
      entityId: booking.id,
      changes: {
        status: { new: BookingStatus.HOLD },
        proposalItemId: { new: item.id },
        holdExpiresAt: { new: holdExpiresAt.toISOString() },
      },
    });

    return booking;
  });
}

export interface ExpireHoldsSummary {
  expiredCount: number;
  bookingIds: string[];
}

/**
 * 홀드 만료 처리 (cron 5분 주기) — holdExpiresAt 경과 HOLD → EXPIRED, 재고 자동 복귀.
 * 개별 트랜잭션 + `status: HOLD` 가드 updateMany — 동시 확정과 경합해도 한쪽만 승리
 */
export async function expireHolds(prisma: PrismaClient, now: Date): Promise<ExpireHoldsSummary> {
  const candidates = await prisma.booking.findMany({
    where: { status: BookingStatus.HOLD, holdExpiresAt: { lte: now } },
    select: {
      id: true,
      villaId: true,
      partnerId: true, // 파트너 예약이면 만료를 파트너에게도 통지 (T-partner-workflow-gaps ①)
      checkIn: true,
      checkOut: true,
      holdExpiresAt: true,
      villa: { select: { supplierId: true, name: true } },
    },
  });

  const expiredIds: string[] = [];
  for (const b of candidates) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.updateMany({
        where: { id: b.id, status: BookingStatus.HOLD }, // 그 사이 확정됐으면 건너뜀
        data: { status: BookingStatus.EXPIRED },
      });
      if (updated.count !== 1) return;

      await tx.notification.create({
        data: {
          userId: b.villa.supplierId,
          type: NotificationType.HOLD_EXPIRED,
          payload: {
            bookingId: b.id,
            villaId: b.villaId,
            villaName: b.villa.name,
            checkIn: b.checkIn.toISOString().slice(0, 10),
            checkOut: b.checkOut.toISOString().slice(0, 10),
          },
        },
      });
      await writeAuditLog({
        db: tx,
        userId: null, // cron 시스템 처리
        action: "UPDATE",
        entity: "Booking",
        entityId: b.id,
        changes: { status: { old: BookingStatus.HOLD, new: BookingStatus.EXPIRED } },
      });
      expiredIds.push(b.id);
    });

    // 파트너에게도 만료 통지 — 커밋 후(외부 Zalo 포함), 실패해도 cron 진행에 무영향(내부 격리).
    if (b.partnerId && expiredIds.includes(b.id)) {
      await notifyPartner(b.partnerId, {
        kind: "HOLD_EXPIRED",
        bookingId: b.id,
        villaName: b.villa.name,
        checkIn: b.checkIn.toISOString().slice(0, 10),
        checkOut: b.checkOut.toISOString().slice(0, 10),
      });
    }
  }

  return { expiredCount: expiredIds.length, bookingIds: expiredIds };
}

/**
 * 입금 확정: HOLD → CONFIRMED (ADMIN — role 검사는 route 책임).
 * 만료 시각이 지났으면 거부 — cron 미처리 상태라도 재고 공정성 우선, 재제안으로 처리
 */
export async function confirmHold(
  prisma: PrismaClient,
  input: { bookingId: string; actorUserId: string; now: Date }
): Promise<Booking> {
  const confirmed = await prisma.$transaction(async (tx) => {
    // ★파트너 지정(PUT /bookings/[id]/partner)·입금과의 경합 직렬화 — 같은 booking 채권 락.
    //   락이 없으면 동시 확정·파트너지정이 서로의 미커밋 쓰기를 못 봐 "CONFIRMED인데 채권 없음" 발생 가능.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`receivable:${input.bookingId}`}))`;
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: { villa: { select: { supplierId: true, name: true } } },
    });
    if (!booking) throw new HoldRejectedError("INVALID_STATUS", "예약이 없습니다");
    if (booking.status !== BookingStatus.HOLD) {
      throw new HoldRejectedError("INVALID_STATUS", `현재 상태: ${booking.status}`);
    }
    if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() <= input.now.getTime()) {
      throw new HoldRejectedError("HOLD_EXPIRED");
    }

    // 파트너 여신 게이트 (ADR-0022) — 한도초과·연체·BLOCKED/SUSPENDED면 확정 차단.
    // 파트너 미연결 예약은 skipped=true로 무영향.
    const credit = await evaluateConfirmCredit(tx, booking.id, input.now);
    if (!credit.allowed) {
      throw new HoldRejectedError("PARTNER_CREDIT_BLOCKED", credit.reason ?? "OVER_LIMIT");
    }

    // status 가드 — ADMIN 동시 조작·cron 만료와의 경합에서 한쪽만 승리 (QA D-2)
    const guarded = await tx.booking.updateMany({
      where: { id: booking.id, status: BookingStatus.HOLD },
      data: { status: BookingStatus.CONFIRMED },
    });
    if (guarded.count !== 1) {
      throw new HoldRejectedError("INVALID_STATUS", "동시 변경이 감지되었습니다");
    }
    const updated = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });

    // 파트너 객실료 채권 생성(멱등) — 선금/잔금·기한 산출 (ADR-0022)
    await ensureReceivableForBooking(tx, booking.id, input.now);

    await tx.notification.create({
      data: {
        userId: booking.villa.supplierId,
        type: NotificationType.BOOKING_CONFIRMED,
        payload: {
          bookingId: booking.id,
          villaId: booking.villaId,
          villaName: booking.villa.name,
          checkIn: booking.checkIn.toISOString().slice(0, 10),
          checkOut: booking.checkOut.toISOString().slice(0, 10),
          guestCount: booking.guestCount,
          guestName: booking.guestName, // 예약자명 — 손님맞이 준비용
          breakfastIncluded: booking.breakfastIncluded, // true일 때만 문구 표기
        },
      },
    });
    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "Booking",
      entityId: booking.id,
      changes: { status: { old: BookingStatus.HOLD, new: BookingStatus.CONFIRMED } },
    });

    return { updated, villaName: booking.villa.name };
  });

  // 파트너 예약이면 확정을 파트너에게도 통지 — 트랜잭션 커밋 후(외부 Zalo 포함), 실패 무해(내부 격리).
  // 객실료 총액·잔금 기한 — 파트너 본인 채권(정당 금액)만. 마진·원가·KRW 미포함.
  if (confirmed.updated.partnerId) {
    const receivable = await prisma.partnerReceivable
      .findUnique({
        where: { bookingId: confirmed.updated.id },
        select: { totalVnd: true, dueDate: true },
      })
      .catch(() => null);
    await notifyPartner(confirmed.updated.partnerId, {
      kind: "BOOKING_CONFIRMED",
      bookingId: confirmed.updated.id,
      villaName: confirmed.villaName,
      checkIn: confirmed.updated.checkIn.toISOString().slice(0, 10),
      checkOut: confirmed.updated.checkOut.toISOString().slice(0, 10),
      totalVnd: receivable ? receivable.totalVnd.toString() : null,
      dueDate: receivable ? receivable.dueDate.toISOString().slice(0, 10) : null,
    });
  }

  return confirmed.updated;
}

/**
 * 취소: HOLD·CONFIRMED → CANCELLED, cancelReason 필수 (SPEC — ADMIN 전용, role 검사는 route).
 * HOLD 취소 허용은 계약서 합의 편차 항목 (착오 홀드 즉시 해제, 재고 즉시 복귀)
 */
export async function cancelBooking(
  prisma: PrismaClient,
  input: {
    bookingId: string;
    cancelReason: string;
    actorUserId: string;
    /** 취소요청 승인 경로에서 "지금 승인 중인 요청" id — 대기요청 자동 종결에서 제외
     *  (그 요청은 이어지는 resolveChangeRequest가 APPROVED로 처리) */
    excludePendingRequestId?: string | null;
  }
): Promise<Booking> {
  const reason = input.cancelReason.trim();
  if (!reason) throw new RangeError("취소 사유(cancelReason)는 필수입니다");

  const cancelled = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: { villa: { select: { supplierId: true, name: true } } },
    });
    if (!booking) throw new HoldRejectedError("INVALID_STATUS", "예약이 없습니다");
    if (booking.status !== BookingStatus.HOLD && booking.status !== BookingStatus.CONFIRMED) {
      throw new HoldRejectedError("INVALID_STATUS", `현재 상태: ${booking.status}`);
    }

    // status 가드 — ADMIN 동시 조작·cron 만료와의 경합에서 한쪽만 승리 (QA D-2)
    const guarded = await tx.booking.updateMany({
      where: {
        id: booking.id,
        status: { in: [BookingStatus.HOLD, BookingStatus.CONFIRMED] },
      },
      data: { status: BookingStatus.CANCELLED, cancelReason: reason },
    });
    if (guarded.count !== 1) {
      throw new HoldRejectedError("INVALID_STATUS", "동시 변경이 감지되었습니다");
    }
    const updated = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });

    // ── 미종결 부가서비스 주문 연쇄 취소 (A5, admin-ops-gaps) ──
    //   예약이 죽었는데 REQUESTED·CONFIRMED 주문이 살아남아 확정·이행되는 사고 방지.
    //   DELIVERED(이미 이행)는 보존. 살아있는 PO(발주됨·수락됨)는 원천 공급자에게 취소 통보
    //   (Zalo는 연결 시, 인앱은 항상 — PATCH service-orders 취소 경로와 동일 규칙).
    const openOrders = await tx.serviceOrder.findMany({
      where: { bookingId: booking.id, status: { in: ["REQUESTED", "CONFIRMED"] } },
      select: {
        id: true,
        quantity: true,
        serviceDate: true,
        catalogItemId: true,
        vendorName: true,
        vendorId: true,
        vendorStatus: true,
        vendor: { select: { userId: true, user: { select: { zaloUserId: true } } } },
      },
    });
    if (openOrders.length > 0) {
      await tx.serviceOrder.updateMany({
        where: { id: { in: openOrders.map((o) => o.id) } },
        data: { status: "CANCELLED" },
      });
      for (const o of openOrders) {
        if (!vendorHasLivePo(o)) continue;
        const vendorUserId = o.vendor?.userId;
        if (!vendorUserId) continue;
        const item = o.catalogItemId
          ? await tx.serviceCatalogItem.findUnique({
              where: { id: o.catalogItemId },
              select: { nameKo: true },
            })
          : null;
        const itemName = item?.nameKo ?? o.vendorName ?? "—";
        const serviceDate = o.serviceDate ? toDateOnlyString(o.serviceDate) : null;
        if (o.vendor?.user?.zaloUserId) {
          await tx.notification.create({
            data: {
              userId: vendorUserId,
              type: NotificationType.VENDOR_PO_CANCELLED,
              payload: { itemName, quantity: o.quantity, villaName: booking.villa.name, serviceDate },
            },
          });
        }
        try {
          const { title, body } = buildVendorNotifText(NotificationType.VENDOR_PO_CANCELLED, {
            itemName,
            quantity: o.quantity,
            villaName: booking.villa.name,
            serviceDate,
          });
          await enqueueInAppNotification({
            db: tx,
            userId: vendorUserId,
            type: NotificationType.VENDOR_PO_CANCELLED,
            title,
            body,
            href: "/vendor",
          });
        } catch {
          // 인앱 적재 실패는 취소 본 처리에 영향 없음
        }
      }
    }

    await tx.notification.create({
      data: {
        userId: booking.villa.supplierId,
        type: NotificationType.BOOKING_CANCELLED,
        payload: {
          bookingId: booking.id,
          villaId: booking.villaId,
          villaName: booking.villa.name,
          checkIn: booking.checkIn.toISOString().slice(0, 10),
          checkOut: booking.checkOut.toISOString().slice(0, 10),
        },
      },
    });
    // 파트너 채권 정리 (T-partner-admin-ops ① — 좀비 채권 방지): 미청구 채권 WRITTEN_OFF 종결.
    // 청구서에 묶인 채권은 미접촉(운영자 청구서 void 흐름) — AuditLog changes에 사실 기록.
    const receivableResult = booking.partnerId
      ? await writeOffReceivableOnCancel(tx, booking.id)
      : ({ kind: "NONE" } as const);

    // 남은 대기 요청 자동 종결 (T-partner-polish 2) — 취소된 예약의 PENDING 요청 방치 방지.
    // 승인 경로의 자기 요청(excludePendingRequestId)은 제외(이어지는 resolve가 APPROVED 처리).
    const autoClosedRequests = booking.partnerId
      ? await autoClosePendingRequestsOnCancel(
          tx,
          booking.id,
          input.excludePendingRequestId
        )
      : 0;

    await writeAuditLog({
      db: tx,
      userId: input.actorUserId,
      action: "UPDATE",
      entity: "Booking",
      entityId: booking.id,
      changes: {
        status: { old: booking.status, new: BookingStatus.CANCELLED },
        cancelReason: { new: reason },
        ...(receivableResult.kind === "WRITTEN_OFF"
          ? {
              receivableStatus: { old: receivableResult.oldStatus, new: "WRITTEN_OFF" },
              // 기입금액은 보존 — 환불/이월은 운영자 수동 처리 대상임을 감사에 남긴다
              receivablePaidVndKept: { new: receivableResult.paidVnd },
            }
          : {}),
        ...(receivableResult.kind === "INVOICED_LEFT"
          ? {
              // ⚠ 청구서에 이미 묶인 채권 — 자동 미접촉. 운영자가 청구서 무효화/조정 필요.
              receivableInvoicedLeft: { new: receivableResult.invoiceId },
            }
          : {}),
        ...(autoClosedRequests > 0
          ? { pendingRequestsAutoClosed: { new: autoClosedRequests } }
          : {}),
      },
    });

    return { updated, villaName: booking.villa.name };
  });

  // 파트너 예약이면 취소를 파트너에게도 통지 — 커밋 후(외부 Zalo 포함), 실패 무해(내부 격리).
  if (cancelled.updated.partnerId) {
    await notifyPartner(cancelled.updated.partnerId, {
      kind: "BOOKING_CANCELLED",
      bookingId: cancelled.updated.id,
      villaName: cancelled.villaName,
      checkIn: cancelled.updated.checkIn.toISOString().slice(0, 10),
      checkOut: cancelled.updated.checkOut.toISOString().slice(0, 10),
    });
  }

  return cancelled.updated;
}
