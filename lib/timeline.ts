import {
  BookingSeller,
  BookingStatus,
  VillaStatus,
  type PrismaClient,
} from "@prisma/client";
import { OCCUPYING_BOOKING_STATUSES, overlapsHalfOpen } from "@/lib/availability";

/**
 * ADMIN 타임라인 매트릭스 데이터 단일 소스 (SPEC F2 ADMIN 뷰 = F7 대시보드 타임라인,
 * 계약: docs/contracts/T1.5-timeline.md)
 *
 * 빌라 × 향후 30일 셀 상태를 산출한다. 셀에는 상태만 담는다 —
 * 고객명·금액·예약 id는 포함하지 않는다 (타임라인 단계 불필요, 상세는 T2.5/T2.6).
 *
 * 날짜 규약: @db.Date·half-open [start, end) — 체크아웃일 셀은 비점유.
 * 축은 UTC 자정 Date 배열, "오늘"은 Asia/Ho_Chi_Minh 기준 날짜 (QA 합의 조건 1).
 */

/** 빌라 소재 타임존 — "오늘" 판정 기준 (CLAUDE.md: Asia/Ho_Chi_Minh 표시) */
const VILLA_TIMEZONE = "Asia/Ho_Chi_Minh";

export const TIMELINE_DAYS = 30;

/**
 * 셀 상태 — T2.6 대시보드 재사용 호환 계약 (이름 변경·순서 변경 금지, 추가만 — T1.5 계약).
 * 우선순위: CHECKED_IN > (CONFIRMED | SUPPLIER_DIRECT) > HOLD > BLOCKED > (EMPTY | NOT_SELLABLE)
 *
 * SUPPLIER_DIRECT(F10/ADR-0021): seller=SUPPLIER 공급자 직접예약의 점유 셀.
 * 운영자 전용 화면에서만 별도 색으로 식별 — 점유 사실만 표시(공급자 판매가는 미포함).
 */
export type TimelineCellState =
  | "EMPTY" // 공실 (판매 가능)
  | "HOLD" // 가예약 — 빗금
  | "CONFIRMED" // 확정 — 파랑 실선
  | "CHECKED_IN" // 투숙 중 — 인디고
  | "BLOCKED" // 차단(수동·iCal) — 회색
  | "NOT_SELLABLE" // 공실이지만 청소 검수 게이트 미통과 — 빨강 테두리
  | "SUPPLIER_DIRECT"; // 공급자 직접예약(F10) — 점유, 별도 색(운영자 전용)

export interface TimelineRow {
  villaId: string;
  villaName: string;
  cells: TimelineCellState[];
}

export interface TimelineData {
  /** UTC 자정 — cells와 같은 길이·순서 */
  axis: Date[];
  /** `M/D` 라벨 (b1 모크 형식, getUTC* 기반 — 서버 로컬 TZ 비의존) */
  dayLabels: string[];
  /** 오늘 열 인덱스 (from=오늘이면 0) */
  todayIndex: number;
  rows: TimelineRow[];
}

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/** Asia/Ho_Chi_Minh 기준 오늘 날짜의 UTC 자정 Date (lib/ical.ts Intl 선례) */
export function todayInVillaTimezone(now: Date = new Date()): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: VILLA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return new Date(
    Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day))
  );
}

/** from(UTC 자정)부터 days일의 UTC 자정 Date 축 */
export function buildDayAxis(from: Date, days: number = TIMELINE_DAYS): Date[] {
  const axis: Date[] = [];
  for (let i = 0; i < days; i++) {
    axis.push(
      new Date(
        Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + i)
      )
    );
  }
  return axis;
}

/** b1 모크의 `7/17` 형식 — getUTC* 기반 (서버 로컬 TZ 비의존, QA 조건 1) */
export function formatDayLabel(day: Date): string {
  return `${day.getUTCMonth() + 1}/${day.getUTCDate()}`;
}

export interface TimelineVillaInput {
  id: string;
  name: string;
  isSellable: boolean;
}

export interface TimelineBookingRange {
  status: BookingStatus;
  /** 판매 주체 — SUPPLIER면 점유 셀을 SUPPLIER_DIRECT로 분류 (F10). 미지정 시 OPERATOR 취급 */
  seller?: BookingSeller;
  checkIn: Date;
  checkOut: Date;
}

export interface TimelineBlockRange {
  startDate: Date;
  endDate: Date;
}

/** 점유 상태별 셀 우선순위 — 더블부킹(차단·예약 겹침) 시 사람이 행동할 상태가 위 */
const BOOKING_CELL_PRIORITY: Record<string, TimelineCellState> = {
  [BookingStatus.CHECKED_IN]: "CHECKED_IN",
  [BookingStatus.CONFIRMED]: "CONFIRMED",
  [BookingStatus.HOLD]: "HOLD",
};
const CELL_RANK: Record<TimelineCellState, number> = {
  CHECKED_IN: 4,
  CONFIRMED: 3,
  // SUPPLIER_DIRECT = CONFIRMED와 동급 점유(색만 구분, F10). CONFIRMED와 겹치면 둘 다 점유
  // 사실이 동일하므로 먼저 만난 쪽 유지(rank 동률 → 갱신 안 함) — 색 안정성 우선.
  SUPPLIER_DIRECT: 3,
  HOLD: 2,
  BLOCKED: 1,
  NOT_SELLABLE: 0,
  EMPTY: 0,
};

/**
 * 한 예약의 셀 상태를 분류한다. seller=SUPPLIER의 점유 상태(CONFIRMED 등)는
 * SUPPLIER_DIRECT로 분류(F10) — 색만 구분, 점유 우선순위는 운영자 확정과 동급.
 * 비점유 상태(CANCELLED 등)는 null(재고 복귀 — 무시).
 */
function bookingCellState(booking: TimelineBookingRange): TimelineCellState | null {
  const base = BOOKING_CELL_PRIORITY[booking.status];
  if (!base) return null;
  // 공급자 직접예약(점유)은 색만 별도. CHECKED_IN은 운영 동작상 그대로 둔다(투숙 중 최우선).
  if (booking.seller === BookingSeller.SUPPLIER && base === "CONFIRMED") {
    return "SUPPLIER_DIRECT";
  }
  return base;
}

/**
 * 한 빌라의 축 전체 셀 상태를 산출하는 순수 함수.
 * 축 밖 구간은 자연히 클리핑된다(셀별 half-open 겹침 판정).
 */
export function computeVillaRow(
  villa: TimelineVillaInput,
  bookings: TimelineBookingRange[],
  blocks: TimelineBlockRange[],
  axis: Date[]
): TimelineCellState[] {
  const emptyState: TimelineCellState = villa.isSellable
    ? "EMPTY"
    : "NOT_SELLABLE";

  return axis.map((day) => {
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    let state: TimelineCellState = emptyState;

    for (const block of blocks) {
      if (overlapsHalfOpen(day, dayEnd, block.startDate, block.endDate)) {
        if (CELL_RANK.BLOCKED > CELL_RANK[state]) state = "BLOCKED";
        break;
      }
    }
    for (const booking of bookings) {
      const cellState = bookingCellState(booking);
      if (!cellState) continue; // 비점유 상태(CANCELLED 등)는 재고 복귀 — 무시
      if (
        overlapsHalfOpen(day, dayEnd, booking.checkIn, booking.checkOut) &&
        CELL_RANK[cellState] > CELL_RANK[state]
      ) {
        state = cellState;
      }
    }
    return state;
  });
}

// ===================== DB 래퍼 층 =====================

/**
 * 타임라인 로드 — status=ACTIVE 전체 빌라의 [from, from+days) 점유 현황.
 * **전체 재고 조망 — ADMIN 전용 소비 전제** (재고 비공개 원칙): 본 함수를 호출하는
 * 화면/route가 반드시 ADMIN 가드 아래 있어야 한다 (findSellableVillaIds와 동일 규칙).
 * 현재 소비처: app/(admin)/dashboard (레이아웃 role 검사 + 미들웨어 이중 가드).
 */
export async function loadTimeline(
  db: PrismaClient,
  options?: { from?: Date; days?: number }
): Promise<TimelineData> {
  const from = options?.from ?? todayInVillaTimezone();
  const days = options?.days ?? TIMELINE_DAYS;
  const axis = buildDayAxis(from, days);
  const rangeEnd = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + days)
  );

  const villas = await db.villa.findMany({
    where: { status: VillaStatus.ACTIVE },
    orderBy: [{ complex: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isSellable: true }, // 최소 select (QA 권고)
  });
  if (villas.length === 0) {
    return { axis, dayLabels: axis.map(formatDayLabel), todayIndex: 0, rows: [] };
  }

  const villaIds = villas.map((v) => v.id);
  const [bookings, blocks] = await Promise.all([
    db.booking.findMany({
      where: {
        villaId: { in: villaIds },
        status: { in: [...OCCUPYING_BOOKING_STATUSES] },
        checkIn: { lt: rangeEnd },
        checkOut: { gt: from },
      },
      // seller 포함(F10) — SUPPLIER 직접예약 셀 분류용. 판매가·고객 식별 정보는 미포함.
      select: { villaId: true, status: true, seller: true, checkIn: true, checkOut: true },
    }),
    db.calendarBlock.findMany({
      where: {
        villaId: { in: villaIds },
        startDate: { lt: rangeEnd },
        endDate: { gt: from },
      },
      select: { villaId: true, startDate: true, endDate: true },
    }),
  ]);

  const bookingsByVilla = new Map<string, TimelineBookingRange[]>();
  for (const b of bookings) {
    const list = bookingsByVilla.get(b.villaId) ?? [];
    list.push(b);
    bookingsByVilla.set(b.villaId, list);
  }
  const blocksByVilla = new Map<string, TimelineBlockRange[]>();
  for (const b of blocks) {
    const list = blocksByVilla.get(b.villaId) ?? [];
    list.push(b);
    blocksByVilla.set(b.villaId, list);
  }

  const rows: TimelineRow[] = villas.map((villa) => ({
    villaId: villa.id,
    villaName: villa.name,
    cells: computeVillaRow(
      villa,
      bookingsByVilla.get(villa.id) ?? [],
      blocksByVilla.get(villa.id) ?? [],
      axis
    ),
  }));

  return { axis, dayLabels: axis.map(formatDayLabel), todayIndex: 0, rows };
}
