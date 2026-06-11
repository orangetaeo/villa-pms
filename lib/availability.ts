import { BookingStatus, Prisma, PrismaClient, VillaStatus } from "@prisma/client";

/**
 * 가용성 판정 단일 소스 (SPEC F2)
 *
 * available(villa, range) =
 *   no Booking(HOLD|CONFIRMED|CHECKED_IN) overlap
 *   AND no CalendarBlock overlap
 *   AND villa.status == ACTIVE
 * 판매 가능 = available AND villa.isSellable (청소 검수 게이트)
 *
 * 구간 비교는 [checkIn, checkOut) half-open — 체크아웃일에 다음 예약 체크인 가능.
 * 화면·API에서 이 판정을 중복 구현하지 말 것. HOLD 생성(T2.3)은 $transaction
 * 클라이언트를 db 인자로 주입해 트랜잭션 안에서 재검증한다.
 */

/** 점유로 계산하는 예약 상태 — EXPIRED·CANCELLED·CHECKED_OUT·NO_SHOW는 재고 복귀 */
export const OCCUPYING_BOOKING_STATUSES = [
  BookingStatus.HOLD,
  BookingStatus.CONFIRMED,
  BookingStatus.CHECKED_IN,
] as const;

/** PrismaClient 또는 prisma.$transaction 콜백의 tx 둘 다 허용 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface StayRange {
  /** 체크인일 (포함) — @db.Date, UTC 자정 */
  checkIn: Date;
  /** 체크아웃일 (제외) — @db.Date, UTC 자정 */
  checkOut: Date;
}

/** 가용성 불가 사유 — UI 안내·로그 분기용 */
export type UnavailableReason =
  | "VILLA_NOT_ACTIVE" // villa.status != ACTIVE
  | "BOOKING_OVERLAP" // HOLD/CONFIRMED/CHECKED_IN 예약 겹침
  | "BLOCK_OVERLAP" // CalendarBlock(수동·iCal) 겹침
  | "NOT_SELLABLE"; // 청소 검수 게이트 미통과 (isSellable=false)

export interface AvailabilityResult {
  /** 재고가 비어 있는가 (예약·차단 없음 + ACTIVE) */
  available: boolean;
  /** 판매 가능한가 = available AND isSellable */
  sellable: boolean;
  reasons: UnavailableReason[];
}

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/** [aStart, aEnd) 와 [bStart, bEnd) 의 겹침 판정 (half-open) */
export function overlapsHalfOpen(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** checkIn < checkOut 검증 — 0박·역전 구간은 판정 자체를 거부 */
export function assertValidStayRange(range: StayRange): void {
  if (!(range.checkIn.getTime() < range.checkOut.getTime())) {
    throw new RangeError(
      `잘못된 숙박 구간: checkIn(${range.checkIn.toISOString()})은 checkOut(${range.checkOut.toISOString()})보다 빨라야 합니다`
    );
  }
}

export interface AvailabilityInput {
  villaStatus: VillaStatus;
  isSellable: boolean;
  overlappingBookingCount: number;
  overlappingBlockCount: number;
}

/** DB 조회 결과를 받아 가용성을 판정하는 순수 함수 */
export function evaluateAvailability(input: AvailabilityInput): AvailabilityResult {
  const reasons: UnavailableReason[] = [];
  if (input.villaStatus !== VillaStatus.ACTIVE) reasons.push("VILLA_NOT_ACTIVE");
  if (input.overlappingBookingCount > 0) reasons.push("BOOKING_OVERLAP");
  if (input.overlappingBlockCount > 0) reasons.push("BLOCK_OVERLAP");

  const available = reasons.length === 0;
  if (!input.isSellable) reasons.push("NOT_SELLABLE");

  return { available, sellable: available && input.isSellable, reasons };
}

// ===================== DB 래퍼 층 =====================

/** [start, end) 겹침 where 조건 — Booking(checkIn/checkOut)용 */
function bookingOverlapWhere(villaId: string, range: StayRange) {
  return {
    villaId,
    status: { in: [...OCCUPYING_BOOKING_STATUSES] },
    checkIn: { lt: range.checkOut },
    checkOut: { gt: range.checkIn },
  } satisfies Prisma.BookingWhereInput;
}

/** [start, end) 겹침 where 조건 — CalendarBlock(startDate/endDate)용 */
function blockOverlapWhere(villaId: string, range: StayRange) {
  return {
    villaId,
    startDate: { lt: range.checkOut },
    endDate: { gt: range.checkIn },
  } satisfies Prisma.CalendarBlockWhereInput;
}

/**
 * 단일 빌라 가용성 판정.
 * @param db PrismaClient 또는 트랜잭션 클라이언트 — HOLD 생성 시 트랜잭션 안에서 호출할 것
 * @throws RangeError 구간이 잘못된 경우 / Error 빌라가 없는 경우
 */
export async function checkAvailability(
  db: DbClient,
  villaId: string,
  range: StayRange
): Promise<AvailabilityResult> {
  assertValidStayRange(range);

  const [villa, overlappingBookingCount, overlappingBlockCount] = await Promise.all([
    db.villa.findUnique({
      where: { id: villaId },
      select: { status: true, isSellable: true },
    }),
    db.booking.count({ where: bookingOverlapWhere(villaId, range) }),
    db.calendarBlock.count({ where: blockOverlapWhere(villaId, range) }),
  ]);

  if (!villa) throw new Error(`빌라를 찾을 수 없습니다: ${villaId}`);

  return evaluateAvailability({
    villaStatus: villa.status,
    isSellable: villa.isSellable,
    overlappingBookingCount,
    overlappingBlockCount,
  });
}

/**
 * 제안 생성(T2.1)용 일괄 필터 — 해당 구간에 판매 가능한 빌라 id만 반환.
 * villaIds를 생략하면 ACTIVE+isSellable 전체 빌라를 대상으로 한다.
 * (전체 재고 조망은 ADMIN 전용 화면에서만 사용할 것 — 재고 비공개 원칙)
 */
export async function findSellableVillaIds(
  db: DbClient,
  range: StayRange,
  villaIds?: string[]
): Promise<string[]> {
  assertValidStayRange(range);

  const candidates = await db.villa.findMany({
    where: {
      ...(villaIds ? { id: { in: villaIds } } : {}),
      status: VillaStatus.ACTIVE,
      isSellable: true,
    },
    select: { id: true },
  });
  if (candidates.length === 0) return [];

  const candidateIds = candidates.map((v) => v.id);
  const [busyBookings, busyBlocks] = await Promise.all([
    db.booking.findMany({
      where: {
        villaId: { in: candidateIds },
        status: { in: [...OCCUPYING_BOOKING_STATUSES] },
        checkIn: { lt: range.checkOut },
        checkOut: { gt: range.checkIn },
      },
      select: { villaId: true },
    }),
    db.calendarBlock.findMany({
      where: {
        villaId: { in: candidateIds },
        startDate: { lt: range.checkOut },
        endDate: { gt: range.checkIn },
      },
      select: { villaId: true },
    }),
  ]);

  const busy = new Set<string>([
    ...busyBookings.map((b) => b.villaId),
    ...busyBlocks.map((b) => b.villaId),
  ]);
  return candidateIds.filter((id) => !busy.has(id));
}
