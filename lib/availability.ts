import {
  BlockSource,
  BookingChannel,
  BookingStatus,
  DepositStatus,
  Prisma,
  PrismaClient,
  VillaSource,
  VillaStatus,
} from "@prisma/client";
import { addUtcDays, parseUtcDateOnly, toDateOnlyString } from "@/lib/date-vn";

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
  | "NOT_SELLABLE" // 청소 검수 게이트 미통과 (isSellable=false)
  | "OVER_CAPACITY"; // 요청 인원 > 빌라 정원(maxGuests) — guestCount 주어졌을 때만 (ADR-0030 T-A)

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
  /** 빌라 정원 (선택) — guestCount와 함께 주어질 때만 정원 검증 (ADR-0030 T-A) */
  maxGuests?: number;
  /** 요청 인원 (선택) — maxGuests와 함께 주어질 때만 검증. 미지정 시 정원 판정 생략(하위호환) */
  guestCount?: number;
}

/**
 * 점유(예약·차단 겹침) 사유 개수 — BOOKING_OVERLAP·BLOCK_OVERLAP만 센다.
 * NOT_SELLABLE(검수 게이트)·VILLA_NOT_ACTIVE는 제외 — "재고가 이미 잡혔는가"만 판정할 때 사용
 * (직접예약 D4: 검수 게이트 무시하고 점유 여부만 본다 / calendar-block 차단 충돌 판정과 동일 의미).
 */
export function countOverlapReasons(reasons: UnavailableReason[]): number {
  return reasons.filter((r) => r === "BOOKING_OVERLAP" || r === "BLOCK_OVERLAP").length;
}

/** DB 조회 결과를 받아 가용성을 판정하는 순수 함수 */
export function evaluateAvailability(input: AvailabilityInput): AvailabilityResult {
  const reasons: UnavailableReason[] = [];
  if (input.villaStatus !== VillaStatus.ACTIVE) reasons.push("VILLA_NOT_ACTIVE");
  if (input.overlappingBookingCount > 0) reasons.push("BOOKING_OVERLAP");
  if (input.overlappingBlockCount > 0) reasons.push("BLOCK_OVERLAP");

  const available = reasons.length === 0;
  if (!input.isSellable) reasons.push("NOT_SELLABLE");

  // 정원 검증 — maxGuests·guestCount 둘 다 주어졌을 때만. 재고(available)엔 영향 없고
  // 판매가능(sellable)만 막는다: 인원이 정원을 넘으면 이 빌라로는 판매 불가 (ADR-0030 T-A).
  const overCapacity =
    input.maxGuests != null && input.guestCount != null && input.guestCount > input.maxGuests;
  if (overCapacity) reasons.push("OVER_CAPACITY");

  return { available, sellable: available && input.isSellable && !overCapacity, reasons };
}

// ===================== DB 래퍼 층 =====================

/**
 * 빌라 재고 쓰기 잠금 — 같은 빌라 재고를 두고 경합하는 모든 쓰기(HOLD 생성,
 * CalendarBlock 생성, iCal upsert)는 트랜잭션 첫 줄에서 이 헬퍼로 **동일한 락 키**를
 * 잡아야 한다 (availability-pattern 교훈: READ COMMITTED에서 재조회→생성만으로는
 * race가 안 막히고, 락 키가 다르면 차단↔홀드 교차 race도 못 막는다).
 * pg_advisory_xact_lock은 트랜잭션 종료 시 자동 해제 — $transaction 안에서만 호출할 것.
 */
export async function lockVillaInventory(tx: Prisma.TransactionClient, villaId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${villaId}))`;
}

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
  range: StayRange,
  /** 요청 인원 (선택) — 주어지면 빌라 정원(maxGuests) 초과 시 OVER_CAPACITY (ADR-0030 T-A) */
  guestCount?: number
): Promise<AvailabilityResult> {
  assertValidStayRange(range);

  const [villa, overlappingBookingCount, overlappingBlockCount] = await Promise.all([
    db.villa.findUnique({
      where: { id: villaId },
      select: { status: true, isSellable: true, maxGuests: true },
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
    maxGuests: villa.maxGuests,
    guestCount,
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
  villaIds?: string[],
  /** 요청 인원 (선택) — 주어지면 정원(maxGuests) 미달 빌라를 후보에서 제외 (ADR-0030 T-A) */
  guestCount?: number
): Promise<string[]> {
  assertValidStayRange(range);

  const candidates = await db.villa.findMany({
    where: {
      ...(villaIds ? { id: { in: villaIds } } : {}),
      status: VillaStatus.ACTIVE,
      isSellable: true,
      ...(guestCount != null ? { maxGuests: { gte: guestCount } } : {}),
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

// ===================== 운영자 공실 보드 (T-admin-availability-board) =====================
//
// ADMIN 전용 빌라×날짜 잠금/공실 보드용 집계. 채널매니저 스타일 타임라인의 데이터 계층.
//
// ⚠ 재고/마진 비공개 원칙: SUPPLIER(외부 공급자) 빌라는 **CalendarBlock(MANUAL/ICAL) 잠금과 공실만**
//   다루고 판매예약(Booking)을 절대 포함하지 않는다 — 공급자 재고와 우리 판매분이 섞이면 재고 노출.
//   예외: DIRECT(테오팀 직접공급) 빌라는 외부 공급자가 없어 노출 대상이 없으므로, 우리 판매예약
//   (HOLD/CONFIRMED/CHECKED_IN)을 BOOKING 셀로 표시한다. 판매가는 canViewFinance 게이트로 가린다.
//
// 날짜 모델: CalendarBlock.startDate(포함)~endDate(제외) half-open. 보드 기간도 [start, end).
//   모든 날짜는 @db.Date 규칙대로 UTC 자정으로 다룬다 (date-vn.parseUtcDateOnly).

/**
 * 보드 셀 상태 — 한 빌라의 한 날짜.
 * BOOKING 은 **DIRECT(직접공급) 빌라에서만** 나타난다 — 우리 판매예약(HOLD/CONFIRMED/CHECKED_IN).
 * SUPPLIER 빌라는 재고 비공개 원칙대로 BOOKING 셀을 절대 갖지 않는다.
 */
export type BoardCellStatus = "AVAILABLE" | "MANUAL" | "ICAL" | "BOOKING";

/**
 * 보드 한 셀의 예약 요약 (BOOKING 셀 전용, DIRECT 빌라).
 * 같은 예약이 걸친 모든 날짜 셀이 동일 요약을 공유한다.
 * ⚠ 재무 게이트: saleCurrency·totalSaleKrw·totalSaleVnd 는 canViewFinance(OWNER/MANAGER/ADMIN)
 *   일 때만 채워지고, STAFF 는 DB select 단계에서 제외되어 항상 null 이다 (S-RBAC-3).
 *   마진은 어떤 경우에도 포함하지 않는다.
 */
export interface BoardBookingSummary {
  id: string;
  status: "HOLD" | "CONFIRMED" | "CHECKED_IN";
  /** 체크인일 YYYY-MM-DD (포함) */
  checkIn: string;
  /** 체크아웃일 YYYY-MM-DD (제외) */
  checkOut: string;
  nights: number;
  guestName: string;
  guestCount: number;
  channel: BookingChannel;
  agencyName: string | null;
  /** 공급자 원가 (VND, 동 단위) — BigInt 직렬화 문자열. STAFF 도 가시 */
  supplierCostVnd: string;
  depositStatus: DepositStatus;
  /** HOLD 만료 시각 ISO — HOLD 가 아니면 null */
  holdExpiresAt: string | null;
  // ── 재무 게이트 (canViewFinance=false 면 전부 null) ──
  saleCurrency: "KRW" | "VND" | null;
  totalSaleKrw: number | null;
  /** BigInt 직렬화 문자열 */
  totalSaleVnd: string | null;
}

/**
 * 보드 한 셀(빌라×날짜).
 * blockId 는 MANUAL 일 때만 채워지며, 그 날짜의 해제 가능한 CalendarBlock id(FE 해제용).
 * AVAILABLE/ICAL/BOOKING 은 항상 null.
 * booking 은 BOOKING 셀에만 채워진다.
 */
export interface BoardCell {
  status: BoardCellStatus;
  /** MANUAL 셀의 해제 대상 CalendarBlock id. 그 외 null */
  blockId: string | null;
  /** BOOKING 셀의 예약 요약 (DIRECT 빌라). 그 외 undefined/null */
  booking?: BoardBookingSummary | null;
}

/** 보드 한 행(빌라) */
export interface AvailabilityBoardVilla {
  id: string;
  name: string;
  /** 지역 필터·그룹핑용 단지명(Villa.complex). 미입력 빌라는 null */
  complex: string | null;
  /** 운영자가 이 빌라 공실을 공급자에게 마지막으로 확인한 시각(ISO) — null=아직 확인 안 함 */
  availabilityCheckedAt: string | null;
  /** 청소 검수 통과율 기반 품질점수(0~100) — 판매 후순위 정렬·표시 (ADMIN 전용) */
  qualityScore: number;
  /**
   * 날짜별 셀. days[i] 는 columns[i] 날짜에 대응(인덱스 정렬).
   * status==AVAILABLE 인 날짜만 잠금 가능(공실), MANUAL/ICAL 은 잠금된 날짜.
   * MANUAL 셀의 blockId 로 해당 날짜를 해제(DELETE)한다.
   */
  days: BoardCell[];
}

/** getAvailabilityBoard 반환 타입 — FE 인계용 (export) */
export interface AvailabilityBoard {
  /** 기간 시작(포함) YYYY-MM-DD, UTC 자정 기준 */
  startDate: string;
  /** 기간 끝(제외) YYYY-MM-DD */
  endDate: string;
  /** 날짜 컬럼 헤더. 각 빌라 days 배열과 인덱스 1:1 대응 */
  columns: string[];
  /** 빌라명 오름차순 정렬된 행 목록 */
  villas: AvailabilityBoardVilla[];
}

export interface GetAvailabilityBoardParams {
  /** 기간 시작 월 "YYYY-MM" — 해당 월 1일부터 */
  startMonth: string;
  /** 조회 개월 수 (기본 3) */
  monthCount?: number;
  /** 지역 필터 = Villa.complex 정확 일치 (선택) */
  area?: string;
  /** 빌라명 부분일치 검색 (선택, 대소문자 무시) */
  search?: string;
  /**
   * 과거 컬럼 클램프 "YYYY-MM-DD" (선택, 보통 todayVnDateString()).
   * 주어지면 columns(및 각 빌라 days) 생성 시작을 max(기간시작, minDate) 로 클램프해
   * 그 이전(과거) 날짜 컬럼은 아예 생성하지 않는다 (columns·days 인덱스 1:1 유지).
   * 미지정 시 기존 동작(기간 시작부터) — 하위호환.
   */
  minDate?: string;
  /**
   * 재무 가시성 — DIRECT 빌라 예약 셀의 판매가(saleCurrency·totalSaleKrw·totalSaleVnd) 포함 여부.
   * 기본 false(안전): STAFF·미지정은 판매가가 DB select 단계에서 제외되어 누수 없음 (S-RBAC-3).
   * 호출부(page.tsx)가 canViewFinance(role) 결과를 넘긴다.
   */
  canViewFinance?: boolean;
}

/** "YYYY-MM" → 해당 월 1일 UTC 자정. 무효 형식이면 null */
function parseMonthStart(yyyymm: string): Date | null {
  if (!/^\d{4}-\d{2}$/.test(yyyymm)) return null;
  return parseUtcDateOnly(`${yyyymm}-01`);
}

/** [start, end) UTC 자정 구간의 날짜 컬럼 배열 "YYYY-MM-DD" */
function buildDateColumns(start: Date, end: Date): string[] {
  const cols: string[] = [];
  for (let d = start; d.getTime() < end.getTime(); d = addUtcDays(d, 1)) {
    cols.push(toDateOnlyString(d));
  }
  return cols;
}

/**
 * 운영자 공실 보드 집계.
 *
 * 대상 빌라: status ∈ {ACTIVE, INACTIVE} (운영 대상 — DRAFT/PENDING_REVIEW/REJECTED 제외).
 * 기간: startMonth 1일 ~ (startMonth + monthCount)월 1일 [start, end) UTC 자정.
 *
 * N+1 회피: 빌라 1쿼리 + 해당 빌라들 CalendarBlock 1쿼리(기간 겹침)로 가져와 메모리에서 조립.
 *
 * MANUAL/ICAL 겹침 우선순위: 같은 날 두 소스가 모두 겹치면 **ICAL 우선**으로 표시한다.
 *   근거 — ICAL 은 외부 채널 원본(읽기전용)이라 이 화면에서 수정 불가하고, MANUAL 로
 *   덮어 보이면 운영자가 "해제 가능"으로 오인할 수 있다. 수정 불가한 사실(ICAL)을 우선 노출해
 *   잘못된 해제 시도를 막는다.
 *
 * @throws RangeError startMonth 형식 오류 또는 monthCount 범위 오류
 */
export async function getAvailabilityBoard(
  db: DbClient,
  params: GetAvailabilityBoardParams
): Promise<AvailabilityBoard> {
  const monthCount = params.monthCount ?? 3;
  if (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > 12) {
    throw new RangeError(`monthCount는 1~12 정수여야 합니다: ${params.monthCount}`);
  }
  const monthStart = parseMonthStart(params.startMonth);
  if (!monthStart) {
    throw new RangeError(`startMonth 형식 오류(YYYY-MM): ${params.startMonth}`);
  }
  // (startMonth + monthCount)월 1일 — UTC 월 산술
  const end = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + monthCount, 1)
  );

  // 과거 컬럼 클램프 — minDate 가 주어지면 max(기간시작, minDate) 로 시작을 당긴다.
  // minDate >= end 이면 컬럼이 비고(과거 전체), days 도 빈 배열이 되어 인덱스 정렬 유지.
  let start = monthStart;
  if (params.minDate) {
    const min = parseUtcDateOnly(params.minDate);
    if (!min) {
      throw new RangeError(`minDate 형식 오류(YYYY-MM-DD): ${params.minDate}`);
    }
    if (min.getTime() > start.getTime()) start = min;
  }

  const columns = buildDateColumns(start, end);
  // 날짜 → 컬럼 인덱스 매핑 (블록 전개 시 O(1) 채움)
  const colIndex = new Map<string, number>();
  columns.forEach((c, i) => colIndex.set(c, i));

  // ── 빌라 목록 (1쿼리) ──
  const search = params.search?.trim();
  const area = params.area?.trim();
  const villas = await db.villa.findMany({
    where: {
      status: { in: [VillaStatus.ACTIVE, VillaStatus.INACTIVE] },
      ...(area ? { complex: area } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    select: { id: true, name: true, complex: true, availabilityCheckedAt: true, source: true, qualityScore: true },
    // 판매 후순위 정렬: 품질점수 내림차순, 동점은 이름순 (Phase 2)
    orderBy: [{ qualityScore: "desc" }, { name: "asc" }],
  });

  if (villas.length === 0) {
    return {
      startDate: toDateOnlyString(start),
      endDate: toDateOnlyString(end),
      columns,
      villas: [],
    };
  }

  // ── 해당 빌라들의 기간 겹침 CalendarBlock (1쿼리) ──
  const villaIds = villas.map((v) => v.id);
  const blocks = await db.calendarBlock.findMany({
    where: {
      villaId: { in: villaIds },
      startDate: { lt: end }, // half-open 겹침: block.start < range.end
      endDate: { gt: start }, // AND block.end > range.start
    },
    select: { id: true, villaId: true, startDate: true, endDate: true, source: true },
  });

  // 빌라별 days 배열 초기화 (전부 AVAILABLE)
  const daysByVilla = new Map<string, BoardCell[]>();
  for (const v of villas) {
    daysByVilla.set(
      v.id,
      columns.map(() => ({ status: "AVAILABLE", blockId: null }) as BoardCell)
    );
  }

  // 블록 구간 [startDate, endDate) 를 날짜별로 전개해 채움
  for (const block of blocks) {
    const days = daysByVilla.get(block.villaId);
    if (!days) continue;
    // 보드 기간으로 클램프
    const from = block.startDate.getTime() > start.getTime() ? block.startDate : start;
    const to = block.endDate.getTime() < end.getTime() ? block.endDate : end;
    for (let d = from; d.getTime() < to.getTime(); d = addUtcDays(d, 1)) {
      const idx = colIndex.get(toDateOnlyString(d));
      if (idx === undefined) continue;
      // 겹침 우선순위: ICAL > MANUAL (이미 ICAL 이면 덮지 않음)
      if (block.source === BlockSource.ICAL) {
        // ICAL 확정 — 읽기전용이라 blockId 불필요(FE 미사용)
        days[idx] = { status: "ICAL", blockId: null };
      } else if (days[idx].status !== "ICAL") {
        // MANUAL — 해제 대상 id 채움. 같은 날 여러 MANUAL 겹치면 마지막 것이 남음(해제 가능 단일 id면 충분)
        days[idx] = { status: "MANUAL", blockId: block.id };
      }
    }
  }

  // ── DIRECT(직접공급) 빌라의 우리 판매예약을 셀에 덮어쓴다 ──
  // 재고 비공개 예외: SUPPLIER 빌라는 절대 조회하지 않는다(외부 공급자에게 노출될 재고가 없는 DIRECT만).
  // 예약은 잠금(MANUAL/ICAL)보다 우선 표시한다 — 블록 채움 이후에 덮어쓰므로 BOOKING 이 최종 우선.
  const canViewFinance = params.canViewFinance === true;
  const directVillaIds = villas.filter((v) => v.source === VillaSource.DIRECT).map((v) => v.id);
  if (directVillaIds.length > 0) {
    const bookings = await db.booking.findMany({
      where: {
        villaId: { in: directVillaIds },
        status: { in: [...OCCUPYING_BOOKING_STATUSES] },
        checkIn: { lt: end }, // half-open 겹침: booking.checkIn < range.end
        checkOut: { gt: start }, // AND booking.checkOut > range.start
      },
      select: {
        id: true,
        villaId: true,
        status: true,
        channel: true,
        agencyName: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        guestName: true,
        guestCount: true,
        supplierCostVnd: true, // 원가는 STAFF 도 가시
        depositStatus: true,
        holdExpiresAt: true,
        // 판매가(통화·KRW·VND)는 canViewFinance 일 때만 select — STAFF 면 DB 단계에서 제외(누수 1차 방어)
        ...(canViewFinance ? { saleCurrency: true, totalSaleKrw: true, totalSaleVnd: true } : {}),
      },
    });

    for (const b of bookings) {
      const days = daysByVilla.get(b.villaId);
      if (!days) continue;
      // 재무 필드 — select 에 없으면 런타임에도 undefined. 게이트 OFF 면 명시적으로 null.
      const fin = b as {
        saleCurrency?: "KRW" | "VND";
        totalSaleKrw?: number | null;
        totalSaleVnd?: bigint | null;
      };
      const summary: BoardBookingSummary = {
        id: b.id,
        status: b.status as "HOLD" | "CONFIRMED" | "CHECKED_IN",
        checkIn: toDateOnlyString(b.checkIn),
        checkOut: toDateOnlyString(b.checkOut),
        nights: b.nights,
        guestName: b.guestName,
        guestCount: b.guestCount,
        channel: b.channel,
        agencyName: b.agencyName,
        supplierCostVnd: b.supplierCostVnd.toString(),
        depositStatus: b.depositStatus,
        holdExpiresAt: b.holdExpiresAt ? b.holdExpiresAt.toISOString() : null,
        saleCurrency: canViewFinance ? (fin.saleCurrency ?? null) : null,
        totalSaleKrw: canViewFinance ? (fin.totalSaleKrw ?? null) : null,
        totalSaleVnd:
          canViewFinance && fin.totalSaleVnd != null ? fin.totalSaleVnd.toString() : null,
      };
      // 예약 구간 [checkIn, checkOut) 을 보드 기간으로 클램프해 날짜별로 덮어쓴다
      const from = b.checkIn.getTime() > start.getTime() ? b.checkIn : start;
      const to = b.checkOut.getTime() < end.getTime() ? b.checkOut : end;
      for (let d = from; d.getTime() < to.getTime(); d = addUtcDays(d, 1)) {
        const idx = colIndex.get(toDateOnlyString(d));
        if (idx === undefined) continue;
        days[idx] = { status: "BOOKING", blockId: null, booking: summary };
      }
    }
  }

  return {
    startDate: toDateOnlyString(start),
    endDate: toDateOnlyString(end),
    columns,
    villas: villas.map((v) => ({
      id: v.id,
      name: v.name,
      complex: v.complex,
      availabilityCheckedAt: v.availabilityCheckedAt
        ? v.availabilityCheckedAt.toISOString()
        : null,
      qualityScore: v.qualityScore,
      days: daysByVilla.get(v.id)!,
    })),
  };
}
