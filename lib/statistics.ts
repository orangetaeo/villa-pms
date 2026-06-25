// lib/statistics.ts — 운영자 통계화면 집계 단일 소스 (T-admin-statistics, 계약 §4)
//
// ★ ADMIN/운영자 라우트 전용. 마진·매출(KRW·VND)·환산은 canViewFinance(OWNER·MANAGER) 전용 —
//   STAFF·공급자·공개(/p)에 절대 노출 금지. 금액 게이트는 load* 인자 includeFinance로 처리하며,
//   false면 반환 객체에 금액 키 자체를 넣지 않는다(페이로드 누수 차단, 계약 §3/§7.1).
//
// 금액 규칙(money-pattern·CLAUDE.md):
//  - VND는 BigInt, KRW는 Int. 합산은 BigInt로만 수행, 마지막에 number/문자열로 변환(부동소수점 금지).
//  - 클라이언트 직렬화 경계 → BigInt 금지. VND는 차트축용 number(VND 크기는 안전정수 범위 내)와
//    정확표시용 포맷문자열(*Text)을 함께 담는다. KRW는 number.
//  - 매출·마진·통화분리·환율 스냅샷 환산은 전부 summarizeFinance(lib/settlement-finance.ts)에 위임 —
//    재구현 금지. 통화(KRW·VND)는 절대 합산하지 않는다(ADR-0003).
//  - 매출 인식 = 체크아웃 월 기준, SETTLEMENT_BOOKING_STATUSES(CHECKED_OUT·NO_SHOW) — 정산과 동일.

import {
  BookingChannel,
  BookingStatus,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatThousands, formatVnd } from "@/lib/format";
import { SETTLEMENT_BOOKING_STATUSES } from "@/lib/settlement";
import {
  summarizeFinance,
  type FinanceBooking,
  type FinanceSummary,
} from "@/lib/settlement-finance";
import {
  computeOccupancyRate,
  OCCUPANCY_STAY_STATUSES,
  type OccupancyBookingRange,
} from "@/lib/booking-stats";
import { effectiveProposalStatus } from "@/lib/proposal";
import {
  resolveQuickRange,
  parseUtcDateOnly,
  addUtcDays,
  todayVnDateString,
  toDateOnlyString,
} from "@/lib/date-vn";

// ===================================================================
// 순수 함수 층 (단위 테스트 대상 — DB 무관)
// ===================================================================

const MS_PER_DAY = 86_400_000;

/** UTC 자정 Date → "YYYY-MM" (월키. 월 버킷 키 산출용) */
function utcMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ===================================================================
// 기간 필터 v2 — 임의 [from, to) + 적응형 버킷 (작업 A)
// ===================================================================
//
// 월 단위 6/12 프리셋(StatsRange)을 폐기하고 임의 달력 기간으로 일반화한다.
// FE page.tsx가 searchParams(range|from|to)를 단 한 번 resolveStatsPeriod로 해석해
// StatsPeriod를 만들어 모든 로더에 주입한다(단일 해석). 집계 의미(통화분리·summarizeFinance·
// 가동률·전환)는 전혀 바꾸지 않고, 시간창/버킷 레이어만 교체한다.

/** 통계 프리셋 키 — date-vn QUICK_RANGE_KEYS에서 nextMonth(미래)는 통계 제외 */
export const STATS_PRESET_KEYS = [
  "all",
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
] as const;
export type StatsPresetKey = (typeof STATS_PRESET_KEYS)[number];

function isStatsPresetKey(key: string | undefined): key is StatsPresetKey {
  return !!key && (STATS_PRESET_KEYS as readonly string[]).includes(key);
}

/** [start, end) UTC 한 버킷. label은 표시용(일='MM-DD', 월='YYYY-MM'). */
export interface StatsBucket {
  key: string;
  start: Date;
  end: Date;
  label: string;
}

/**
 * 해석된 통계 기간 — 모든 로더 입력. 직렬화 가능 부분(fromText/toText/presetKey/granularity)은
 * 그대로 client에 내려 보낼 수 있다(Date는 서버 로더 전용).
 */
export interface StatsPeriod {
  /** [from, to) UTC 자정 — to는 배타(half-open) */
  from: Date;
  to: Date;
  /** 'YYYY-MM-DD' 달력 입력·표시용. toText는 포함일(=실제 to − 1일) */
  fromText: string;
  toText: string;
  granularity: "day" | "month";
  buckets: StatsBucket[];
  /** 직전 동일 길이 창 [from-span, from). 'all'·데이터부족 시 null */
  previous: { from: Date; to: Date } | null;
  /** UI 강조용 프리셋 키. 커스텀이면 null */
  presetKey: string | null;
}

/** day 버킷 라벨 'MM-DD' (UTC 자정 기준) */
function dayLabel(d: Date): string {
  return toDateOnlyString(d).slice(5); // 'YYYY-MM-DD' → 'MM-DD'
}

/** 적응형 버킷 생성 — granularity에 따라 일/월 버킷을 [from, to) 클리핑하여 산출 */
function buildBuckets(
  from: Date,
  to: Date,
  granularity: "day" | "month"
): StatsBucket[] {
  const buckets: StatsBucket[] = [];
  if (granularity === "day") {
    for (let cur = from; cur.getTime() < to.getTime(); cur = addUtcDays(cur, 1)) {
      const end = addUtcDays(cur, 1);
      const clippedEnd = end.getTime() > to.getTime() ? to : end;
      buckets.push({
        key: toDateOnlyString(cur),
        start: cur,
        end: clippedEnd,
        label: dayLabel(cur),
      });
    }
    return buckets;
  }
  // month — VN 월키별 1버킷, 각 버킷 start/end는 [from, to) 클리핑
  let cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cur.getTime() < to.getTime()) {
    const monthStart = cur;
    const monthEnd = new Date(
      Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1)
    );
    const start = monthStart.getTime() < from.getTime() ? from : monthStart;
    const end = monthEnd.getTime() > to.getTime() ? to : monthEnd;
    buckets.push({
      key: utcMonthKey(monthStart),
      start,
      end,
      label: utcMonthKey(monthStart),
    });
    cur = monthEnd;
  }
  return buckets;
}

/** spanDays(=일 수) → granularity. 92일 이하면 일 버킷, 초과면 월 버킷. */
function pickGranularity(spanDays: number): "day" | "month" {
  return spanDays <= 92 ? "day" : "month";
}

/**
 * resolveStatsPeriod — searchParams(range|from|to)를 단일 해석해 StatsPeriod 산출.
 * - 커스텀(from·to 둘 다) 우선: from=parseUtcDateOnly(from), to=addUtcDays(to, 1)(포함→배타).
 * - 프리셋: resolveQuickRange(key)로 [from, to) 달력일. 'all'은 데이터 최소일~내일.
 * - 무효·미지정: thisMonth.
 * granularity: spanDays≤92 → 'day'(하루당 1버킷), 그 외 → 'month'(VN 월키별 1버킷).
 * previous: span=to−from, previous={from−span, from}. 'all'은 null.
 *
 * @param dataFloor 'all' 산출용 데이터 최소일(min(checkOut) 등). 미지정·데이터 없으면 to−1개월.
 */
export function resolveStatsPeriod(
  params: { range?: string; from?: string; to?: string },
  now: Date = new Date(),
  dataFloor?: Date | null
): StatsPeriod {
  // 내일(VN 기준) — 'all'의 to(배타). 진행 중 오늘까지 포함.
  const todayUtc = parseUtcDateOnly(todayVnDateString(now))!;
  const tomorrowUtc = addUtcDays(todayUtc, 1);

  let from: Date;
  let to: Date;
  let presetKey: string | null = null;

  const customFrom = params.from ? parseUtcDateOnly(params.from) : null;
  const customTo = params.to ? parseUtcDateOnly(params.to) : null;

  if (customFrom && customTo && customTo.getTime() >= customFrom.getTime()) {
    // 커스텀 우선 — to는 사용자가 고른 포함일 → 배타로 +1일
    from = customFrom;
    to = addUtcDays(customTo, 1);
    presetKey = null;
  } else if (isStatsPresetKey(params.range)) {
    presetKey = params.range!;
    if (params.range === "all") {
      // 데이터 최소일 ~ 내일. 데이터 없으면 to−1개월.
      to = tomorrowUtc;
      const floor =
        dataFloor && !Number.isNaN(dataFloor.getTime())
          ? new Date(Date.UTC(dataFloor.getUTCFullYear(), dataFloor.getUTCMonth(), dataFloor.getUTCDate()))
          : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, to.getUTCDate()));
      from = floor.getTime() < to.getTime() ? floor : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, to.getUTCDate()));
    } else {
      const r = resolveQuickRange(params.range, now)!; // all 외 프리셋은 항상 non-null
      from = parseUtcDateOnly(r.from)!;
      to = parseUtcDateOnly(r.to)!;
    }
  } else {
    // 무효·미지정 → thisMonth
    presetKey = "thisMonth";
    const r = resolveQuickRange("thisMonth", now)!;
    from = parseUtcDateOnly(r.from)!;
    to = parseUtcDateOnly(r.to)!;
  }

  const spanDays = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
  const granularity = pickGranularity(spanDays);
  const buckets = buildBuckets(from, to, granularity);

  // previous: 직전 동일 길이 창. 'all'은 의미가 없어 null.
  const previous =
    presetKey === "all" || spanDays <= 0
      ? null
      : { from: new Date(from.getTime() - spanDays * MS_PER_DAY), to: from };

  return {
    from,
    to,
    fromText: toDateOnlyString(from),
    toText: toDateOnlyString(addUtcDays(to, -1)), // 배타 to → 포함 표시일
    granularity,
    buckets,
    previous,
    presetKey,
  };
}

/**
 * 전환율(%) — 분모 0이면 0 반환(0건 분모 무오류, 계약 §4.6). 소수 1자리.
 * 부동소수점은 표시용 비율에만 사용(금액 아님 — money-pattern 무관).
 */
export function conversionRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** 전월 대비 증감률(%) — 이전값 0이면 null(분모 0, ÷0 방지). 소수 1자리. */
export function changeRate(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * BigInt VND → 클라이언트 직렬화 쌍 { vnd: number, vndText: string }.
 * vnd는 차트축용(안전정수 범위), vndText는 정확표시용 포맷(쉼표+₫). 음수(역마진) 보존.
 */
export interface VndAmount {
  /** 차트축·정렬용 number — VND 크기는 Number.MAX_SAFE_INTEGER 내 */
  vnd: number;
  /** 정확표시용 포맷 문자열 (역마진은 -프리픽스) */
  vndText: string;
}

export function toVndAmount(v: bigint): VndAmount {
  const text = v < 0n ? `-${formatVnd((-v).toString())}` : formatVnd(v.toString());
  return { vnd: Number(v), vndText: text };
}

/** KRW Int → { krw: number, krwText: string } ("12,450,000원") */
export interface KrwAmount {
  krw: number;
  krwText: string;
}

export function toKrwAmount(v: number): KrwAmount {
  return { krw: v, krwText: `${formatThousands(v)}원` };
}

/** Prisma 행 → FinanceBooking 매핑 (Decimal fxVndPerKrw → 문자열). 재사용(settlements 패턴과 동일). */
export interface FinanceSourceRow {
  saleCurrency: FinanceBooking["saleCurrency"];
  totalSaleKrw: number | null;
  totalSaleVnd: bigint | null;
  supplierCostVnd: bigint;
  fxVndPerKrw: { toString(): string } | null;
}

export function toFinanceBooking(b: FinanceSourceRow): FinanceBooking {
  return {
    saleCurrency: b.saleCurrency,
    totalSaleKrw: b.totalSaleKrw,
    totalSaleVnd: b.totalSaleVnd,
    supplierCostVnd: b.supplierCostVnd,
    fxVndPerKrw: b.fxVndPerKrw != null ? b.fxVndPerKrw.toString() : null,
  };
}

/** summarizeFinance 결과(BigInt) → 직렬화 가능한 재무 블록 (KRW·VND 분리 유지). */
export interface FinanceBlock {
  krwRevenue: number;
  krwRevenueText: string;
  /** VND 수납 합(VND 채널) */
  vndRevenue: number;
  vndRevenueText: string;
  /** 환산 마진(VND, 환율 스냅샷 기준 참고치) */
  marginVnd: number;
  marginVndText: string;
  /** 환율 미기록으로 환산·마진에서 제외된 KRW 예약 수 */
  fxMissingCount: number;
  /** 평균 마진율(%) = 마진 / 수납 VND환산 × 100. 환산 0이면 null */
  marginRatePct: number | null;
}

/** FinanceSummary → FinanceBlock (통화 분리 유지, 마진율 파생). */
export function toFinanceBlock(s: FinanceSummary): FinanceBlock {
  const krw = toKrwAmount(s.collectedKrw);
  const vnd = toVndAmount(s.collectedVnd);
  const margin = toVndAmount(s.marginVnd);
  // 마진율 = 마진 / 수납 VND환산(전체). 환산 합 0이면 null (÷0 방지).
  const equiv = s.collectedVndEquivalent;
  const marginRatePct =
    equiv > 0n ? Math.round((Number(s.marginVnd) / Number(equiv)) * 1000) / 10 : null;
  return {
    krwRevenue: krw.krw,
    krwRevenueText: krw.krwText,
    vndRevenue: vnd.vnd,
    vndRevenueText: vnd.vndText,
    marginVnd: margin.vnd,
    marginVndText: margin.vndText,
    fxMissingCount: s.fxMissingCount,
    marginRatePct,
  };
}

// ===================================================================
// DB 로더 층 (서버 전용)
// ===================================================================

const SETTLEMENT_STATUS_FILTER = [...SETTLEMENT_BOOKING_STATUSES];
const OCCUPANCY_STATUS_FILTER = [...OCCUPANCY_STAY_STATUSES];

/**
 * 'all' 프리셋 산출용 데이터 최소일 — min(booking.checkOut). 없으면 null.
 * page.tsx가 resolveStatsPeriod의 dataFloor 인자로 주입한다(데이터 없으면 to−1개월 폴백).
 */
export async function loadDataFloor(db: PrismaClient = prisma): Promise<Date | null> {
  const first = await db.booking.findFirst({
    where: { status: { in: SETTLEMENT_STATUS_FILTER } },
    orderBy: { checkOut: "asc" },
    select: { checkOut: true },
  });
  return first?.checkOut ?? null;
}

// ── 1. 개요(매출·마진) — canViewFinance 전용 ────────────────────────

/** 버킷별 매출 추이 1행 (통화 분리). 합산 금지 — KRW·VND 나란히. */
export interface RevenueTrendPoint {
  /** 버킷 키(일='YYYY-MM-DD', 월='YYYY-MM') */
  bucketKey: string;
  /** 표시 라벨(일='MM-DD', 월='YYYY-MM') */
  label: string;
  krwRevenue: number;
  krwRevenueText: string;
  vndRevenue: number;
  vndRevenueText: string;
  /** 환산 마진(VND, 환율 스냅샷 기준 참고치) */
  marginVnd: number;
  marginVndText: string;
  /** 환율 미기록 제외 건수 */
  fxMissingCount: number;
}

/** KPI(기간 총계) + 직전 동기간 대비. 통화 분리. */
export interface RevenueKpi {
  krwRevenue: number;
  krwRevenueText: string;
  vndRevenue: number;
  vndRevenueText: string;
  marginVnd: number;
  marginVndText: string;
  marginRatePct: number | null;
  fxMissingCount: number;
  /** 직전 동기간 대비 증감률(%) — previous 없음·이전값 0이면 null */
  krwChangePct: number | null;
  vndChangePct: number | null;
  marginChangePct: number | null;
}

/** 채널별 건수·매출(통화별). 도넛/막대 소스. */
export interface ChannelStat {
  channel: BookingChannel;
  bookingCount: number;
  krwRevenue: number;
  krwRevenueText: string;
  vndRevenue: number;
  vndRevenueText: string;
}

export interface OverviewStats {
  /** 버킷 키 배열(차트 x축 순서) */
  bucketKeys: string[];
  trend: RevenueTrendPoint[];
  /** 기간 총계 KPI(+ 직전 동기간 대비) */
  current: RevenueKpi;
  channels: ChannelStat[];
}

interface RevenueSourceRow extends FinanceSourceRow {
  checkOut: Date;
  channel: BookingChannel;
}

const REVENUE_SELECT = {
  checkOut: true,
  channel: true,
  saleCurrency: true,
  totalSaleKrw: true,
  totalSaleVnd: true,
  supplierCostVnd: true,
  fxVndPerKrw: true,
} as const;

/** [start, end) 내 행만 필터 (체크아웃 @db.Date UTC 경계) */
function rowsInRange<T extends { checkOut: Date }>(rows: T[], start: Date, end: Date): T[] {
  return rows.filter(
    (r) => r.checkOut.getTime() >= start.getTime() && r.checkOut.getTime() < end.getTime()
  );
}

/**
 * loadOverviewStats — 재무 전용(canViewFinance 게이트는 호출부(page.tsx)에서 확인 후 호출).
 * 버킷별 매출추이 + 기간 총계 KPI(직전 동기간 대비) + 채널별 건수·매출.
 * 매출 인식 = 체크아웃일, SETTLEMENT_BOOKING_STATUSES. 통화 분리·마진 환산은 summarizeFinance.
 */
export async function loadOverviewStats(
  period: StatsPeriod,
  _now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<OverviewStats> {
  // 추이·총계 + 직전 동기간 KPI를 위해 previous.from(있으면)까지 한 번에 조회
  const queryStart = period.previous ? period.previous.from : period.from;

  const rows: RevenueSourceRow[] = await db.booking.findMany({
    where: {
      status: { in: SETTLEMENT_STATUS_FILTER },
      checkOut: { gte: queryStart, lt: period.to },
    },
    select: REVENUE_SELECT,
  });

  const inPeriodRows = rowsInRange(rows, period.from, period.to);

  // 버킷별 추이 — period.buckets 순회([start, end) 클리핑)
  const trend: RevenueTrendPoint[] = period.buckets.map((bucket) => {
    const list = rowsInRange(rows, bucket.start, bucket.end);
    const block = toFinanceBlock(summarizeFinance(list.map(toFinanceBooking)));
    return {
      bucketKey: bucket.key,
      label: bucket.label,
      krwRevenue: block.krwRevenue,
      krwRevenueText: block.krwRevenueText,
      vndRevenue: block.vndRevenue,
      vndRevenueText: block.vndRevenueText,
      marginVnd: block.marginVnd,
      marginVndText: block.marginVndText,
      fxMissingCount: block.fxMissingCount,
    };
  });

  // 기간 총계 KPI + 직전 동기간 대비
  const currentBlock = toFinanceBlock(summarizeFinance(inPeriodRows.map(toFinanceBooking)));
  const prevBlock = period.previous
    ? toFinanceBlock(
        summarizeFinance(
          rowsInRange(rows, period.previous.from, period.previous.to).map(toFinanceBooking)
        )
      )
    : null;

  const current: RevenueKpi = {
    krwRevenue: currentBlock.krwRevenue,
    krwRevenueText: currentBlock.krwRevenueText,
    vndRevenue: currentBlock.vndRevenue,
    vndRevenueText: currentBlock.vndRevenueText,
    marginVnd: currentBlock.marginVnd,
    marginVndText: currentBlock.marginVndText,
    marginRatePct: currentBlock.marginRatePct,
    fxMissingCount: currentBlock.fxMissingCount,
    krwChangePct: prevBlock ? changeRate(currentBlock.krwRevenue, prevBlock.krwRevenue) : null,
    vndChangePct: prevBlock ? changeRate(currentBlock.vndRevenue, prevBlock.vndRevenue) : null,
    marginChangePct: prevBlock ? changeRate(currentBlock.marginVnd, prevBlock.marginVnd) : null,
  };

  // 채널별 — 기간 [from, to) 내 매출만
  const byChannel = new Map<BookingChannel, RevenueSourceRow[]>();
  for (const r of inPeriodRows) {
    const list = byChannel.get(r.channel) ?? [];
    list.push(r);
    byChannel.set(r.channel, list);
  }
  const channels: ChannelStat[] = [
    BookingChannel.TRAVEL_AGENCY,
    BookingChannel.LAND_AGENCY,
    BookingChannel.DIRECT,
  ].map((channel) => {
    const list = byChannel.get(channel) ?? [];
    const s = summarizeFinance(list.map(toFinanceBooking));
    const krw = toKrwAmount(s.collectedKrw);
    const vnd = toVndAmount(s.collectedVnd);
    return {
      channel,
      bookingCount: list.length,
      krwRevenue: krw.krw,
      krwRevenueText: krw.krwText,
      vndRevenue: vnd.vnd,
      vndRevenueText: vnd.vndText,
    };
  });

  return {
    bucketKeys: period.buckets.map((b) => b.key),
    trend,
    current,
    channels,
  };
}

// ── 2. 가동률(점유율) — 전 운영자 ───────────────────────────────────

export interface OccupancyTrendPoint {
  /** 버킷 키(일='YYYY-MM-DD', 월='YYYY-MM') */
  bucketKey: string;
  label: string;
  /** 가동률(%) 0~100, 소수 1자리 */
  ratePct: number;
}

export interface VillaOccupancy {
  villaId: string;
  name: string;
  complex: string | null;
  occupiedNights: number;
  ratePct: number;
}

export interface OccupancyStats {
  /** 버킷별 가동률 추이(라인) */
  trend: OccupancyTrendPoint[];
  /** 기간 전체 가동률(%) */
  currentRatePct: number;
  /** 직전 동기간 대비 증감(%포인트, 소수 1자리). previous 없음·이전 0%면 null */
  changePct: number | null;
  /** 기간 평균 박수(점유박/예약수). 예약 0건이면 0 */
  avgNights: number;
  /** 기간 점유 예약수 */
  bookingCount: number;
  /** 빌라별 가동률 내림차순(기간) */
  villas: VillaOccupancy[];
}

interface OccupancyBookingRow extends OccupancyBookingRange {
  villaId: string;
}

/** half-open [checkIn, checkOut) 의 [winStart, winEnd) 클리핑 점유박 (computeOccupancyRate와 동일 규약) */
function clippedNights(b: OccupancyBookingRange, winStart: Date, winEnd: Date): number {
  const start = Math.max(b.checkIn.getTime(), winStart.getTime());
  const end = Math.min(b.checkOut.getTime(), winEnd.getTime());
  if (end <= start) return 0;
  return Math.round((end - start) / MS_PER_DAY);
}

/**
 * loadOccupancyStats — 전 운영자. 버킷별 가동률 추이(computeOccupancyRate 재사용)
 * + 기간 전체 가동률·직전 동기간 대비·평균박수 + 빌라별 가동률 내림차순. 점유상태=OCCUPANCY_STAY_STATUSES.
 * 분모 빌라수 = 현재 ACTIVE 근사(헬퍼 주석과 동일 — 기간 중 승인 시점 무시).
 * 가동률 분모: 버킷별 (ACTIVE × 버킷일수), 전체 (ACTIVE × 기간일수).
 */
export async function loadOccupancyStats(
  period: StatsPeriod,
  _now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<OccupancyStats> {
  // 추이·총계·직전 동기간을 모두 덮는 윈도우 — previous.from(있으면)부터
  const windowStart = period.previous ? period.previous.from : period.from;
  const windowEnd = period.to;

  const [bookings, activeVillaCount, villas] = await Promise.all([
    db.booking.findMany({
      where: {
        status: { in: OCCUPANCY_STATUS_FILTER },
        checkIn: { lt: windowEnd },
        checkOut: { gt: windowStart },
      },
      select: { status: true, checkIn: true, checkOut: true, villaId: true },
    }),
    db.villa.count({ where: { status: "ACTIVE" } }),
    db.villa.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, complex: true },
    }),
  ]);

  const rows: OccupancyBookingRow[] = bookings;

  // 버킷별 추이 — 각 버킷마다 computeOccupancyRate(전체 ACTIVE 분모) 재사용
  const trend: OccupancyTrendPoint[] = period.buckets.map((bucket) => {
    const ratePct = computeOccupancyRate(rows, activeVillaCount, bucket.start, bucket.end);
    return { bucketKey: bucket.key, label: bucket.label, ratePct };
  });

  // 기간 전체 가동률(분모 = ACTIVE × 기간일수)
  const currentRatePct = computeOccupancyRate(rows, activeVillaCount, period.from, period.to);
  const prevRatePct = period.previous
    ? computeOccupancyRate(rows, activeVillaCount, period.previous.from, period.previous.to)
    : null;
  const changePct =
    prevRatePct == null || prevRatePct === 0
      ? null
      : Math.round((currentRatePct - prevRatePct) * 10) / 10;

  // 기간 빌라별 점유박 + 예약수
  const periodDays = Math.round((period.to.getTime() - period.from.getTime()) / MS_PER_DAY);
  const nightsByVilla = new Map<string, number>();
  let currentBookingCount = 0;
  for (const b of rows) {
    const n = clippedNights(b, period.from, period.to);
    if (n <= 0) continue;
    currentBookingCount += 1;
    nightsByVilla.set(b.villaId, (nightsByVilla.get(b.villaId) ?? 0) + n);
  }
  const totalOccupiedNights = [...nightsByVilla.values()].reduce((a, b) => a + b, 0);
  const avgNights =
    currentBookingCount > 0
      ? Math.round((totalOccupiedNights / currentBookingCount) * 10) / 10
      : 0;

  const villaStats: VillaOccupancy[] = villas.map((v) => {
    const occupiedNights = nightsByVilla.get(v.id) ?? 0;
    const ratePct =
      periodDays > 0
        ? Math.round(Math.min((occupiedNights / periodDays) * 100, 100) * 10) / 10
        : 0;
    return { villaId: v.id, name: v.name, complex: v.complex, occupiedNights, ratePct };
  });
  villaStats.sort((a, b) => b.ratePct - a.ratePct || b.occupiedNights - a.occupiedNights);

  return {
    trend,
    currentRatePct,
    changePct,
    avgNights,
    bookingCount: currentBookingCount,
    villas: villaStats,
  };
}

// ── 3. 빌라 성과 — 전 운영자 (금액 컬럼만 게이트) ────────────────────

/** 금액 키(krwRevenue·vndRevenue·marginVnd*)는 includeFinance=true일 때만 존재 */
export interface VillaPerformanceRow {
  villaId: string;
  name: string;
  complex: string | null;
  bookingCount: number;
  occupiedNights: number;
  ratePct: number;
  // ── canViewFinance 전용(includeFinance=true) — false면 아래 키 자체 없음 ──
  krwRevenue?: number;
  krwRevenueText?: string;
  vndRevenue?: number;
  vndRevenueText?: string;
  marginVnd?: number;
  marginVndText?: string;
}

/**
 * loadVillaPerformance — 빌라별 예약수·점유박·가동률 항상 + includeFinance=true일 때만
 * 매출·마진 필드 포함(false면 객체에 그 키 자체를 넣지 않음 — STAFF 페이로드 누수 차단, 계약 §3/§7.1).
 * 가동률 분모 = 해당 빌라의 (기간 월수 × 평균 월일수) 근사 — 빌라별 점유박/기간일수.
 */
export async function loadVillaPerformance(
  period: StatsPeriod,
  includeFinance: boolean,
  _now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<VillaPerformanceRow[]> {
  const periodDays = Math.round((period.to.getTime() - period.from.getTime()) / MS_PER_DAY);

  // 점유: 기간 내 점유상태 예약 (가동률·예약수·박수)
  const occBookings = await db.booking.findMany({
    where: {
      status: { in: OCCUPANCY_STATUS_FILTER },
      checkIn: { lt: period.to },
      checkOut: { gt: period.from },
    },
    select: { villaId: true, status: true, checkIn: true, checkOut: true },
  });

  // 매출: 정산 기준(체크아웃일·SETTLEMENT_BOOKING_STATUSES) — includeFinance일 때만
  const finBookings = includeFinance
    ? await db.booking.findMany({
        where: {
          status: { in: SETTLEMENT_STATUS_FILTER },
          checkOut: { gte: period.from, lt: period.to },
        },
        select: {
          villaId: true,
          saleCurrency: true,
          totalSaleKrw: true,
          totalSaleVnd: true,
          supplierCostVnd: true,
          fxVndPerKrw: true,
        },
      })
    : [];

  const villas = await db.villa.findMany({
    select: { id: true, name: true, complex: true },
  });

  // 빌라별 점유박·예약수
  const nightsByVilla = new Map<string, number>();
  const bookingCountByVilla = new Map<string, number>();
  for (const b of occBookings) {
    const n = clippedNights(b, period.from, period.to);
    if (n <= 0) continue;
    nightsByVilla.set(b.villaId, (nightsByVilla.get(b.villaId) ?? 0) + n);
    bookingCountByVilla.set(b.villaId, (bookingCountByVilla.get(b.villaId) ?? 0) + 1);
  }

  // 빌라별 재무 합계 (includeFinance일 때만)
  const finByVilla = new Map<string, FinanceBooking[]>();
  if (includeFinance) {
    for (const b of finBookings) {
      const list = finByVilla.get(b.villaId) ?? [];
      list.push(toFinanceBooking(b));
      finByVilla.set(b.villaId, list);
    }
  }

  const result: VillaPerformanceRow[] = villas.map((v) => {
    const occupiedNights = nightsByVilla.get(v.id) ?? 0;
    const ratePct =
      periodDays > 0
        ? Math.round(Math.min((occupiedNights / periodDays) * 100, 100) * 10) / 10
        : 0;
    const base: VillaPerformanceRow = {
      villaId: v.id,
      name: v.name,
      complex: v.complex,
      bookingCount: bookingCountByVilla.get(v.id) ?? 0,
      occupiedNights,
      ratePct,
    };
    if (includeFinance) {
      const s = summarizeFinance(finByVilla.get(v.id) ?? []);
      const krw = toKrwAmount(s.collectedKrw);
      const vnd = toVndAmount(s.collectedVnd);
      const margin = toVndAmount(s.marginVnd);
      base.krwRevenue = krw.krw;
      base.krwRevenueText = krw.krwText;
      base.vndRevenue = vnd.vnd;
      base.vndRevenueText = vnd.vndText;
      base.marginVnd = margin.vnd;
      base.marginVndText = margin.vndText;
    }
    return base;
  });

  // 기본 정렬 = 가동률 내림차순(화면에서 토글 재정렬)
  result.sort((a, b) => b.ratePct - a.ratePct || b.occupiedNights - a.occupiedNights);
  return result;
}

// ── 4. 제안 전환 깔때기 — 전 운영자 ─────────────────────────────────

export interface FunnelStep {
  /** 단계 키: proposals → reserved → confirmed → checkedOut */
  key: "proposals" | "reserved" | "confirmed" | "checkedOut";
  count: number;
  /** 직전 단계 대비 전환율(%). 첫 단계는 null */
  conversionPct: number | null;
}

export interface FunnelStats {
  steps: FunnelStep[];
}

/**
 * loadFunnelStats — 제안 전환 4단계(제안생성→가예약→확정→체크아웃) + 단계별 전환율.
 * 가예약 발생 = ProposalItem.bookingId 연결된 제안. 확정/체크아웃 = 그 예약의 도달 상태.
 * effectiveProposalStatus로 만료 반영(생성 카운트는 만료 무관 전수, 표시 라벨용으로 만료 분리 가능).
 */
export async function loadFunnelStats(
  period: StatsPeriod,
  now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<FunnelStats> {
  // 기간 내 생성된 제안 + 항목의 연결 예약 상태.
  // createdAt은 timestamp(UTC 순간) — period.from/to는 UTC 자정 경계로 그대로 사용(기존 규약 유지).
  const proposals = await db.proposal.findMany({
    where: { createdAt: { gte: period.from, lt: period.to } },
    select: {
      status: true,
      expiresAt: true,
      items: {
        select: {
          booking: { select: { status: true } },
        },
      },
    },
  });

  let proposalsCount = 0;
  let reservedCount = 0; // 가예약 1건 이상 발생
  let confirmedCount = 0; // 확정 도달(CONFIRMED·CHECKED_IN·CHECKED_OUT·NO_SHOW 중 하나)
  let checkedOutCount = 0; // 체크아웃 도달

  const CONFIRMED_REACHED = new Set<BookingStatus>([
    BookingStatus.CONFIRMED,
    BookingStatus.CHECKED_IN,
    BookingStatus.CHECKED_OUT,
    BookingStatus.NO_SHOW,
  ]);

  for (const p of proposals) {
    proposalsCount += 1;
    // effectiveProposalStatus — 만료 반영(전수 카운트엔 영향 없지만 규약 준수·향후 라벨용)
    void effectiveProposalStatus(p.status, p.expiresAt, now);
    const bookings = p.items.map((it) => it.booking).filter((b): b is { status: BookingStatus } => b != null);
    if (bookings.length > 0) reservedCount += 1; // 가예약(HOLD 이상) 발생
    if (bookings.some((b) => CONFIRMED_REACHED.has(b.status))) confirmedCount += 1;
    if (bookings.some((b) => b.status === BookingStatus.CHECKED_OUT)) checkedOutCount += 1;
  }

  const steps: FunnelStep[] = [
    { key: "proposals", count: proposalsCount, conversionPct: null },
    { key: "reserved", count: reservedCount, conversionPct: conversionRate(reservedCount, proposalsCount) },
    { key: "confirmed", count: confirmedCount, conversionPct: conversionRate(confirmedCount, reservedCount) },
    { key: "checkedOut", count: checkedOutCount, conversionPct: conversionRate(checkedOutCount, confirmedCount) },
  ];

  return { steps };
}

// ── 5. 운영지표 — 전 운영자 (금액 부분만 게이트) ────────────────────

export interface OperationsStats {
  /** 홀드 만료율(%) = EXPIRED / 기간 내 생성 HOLD 총수 */
  holdExpiryPct: number;
  holdCreatedCount: number;
  holdExpiredCount: number;
  /** 취소율(%) = CANCELLED / 기간 내 생성 예약 전체 */
  cancelPct: number;
  /** NO_SHOW율(%) = NO_SHOW / (CHECKED_OUT + NO_SHOW) */
  noShowPct: number;
  /** 청소 검수 */
  cleaning: {
    /** 평균 처리시간(시간) — approvedAt − 제출시각. 제출시각 별도 기록 없어 updatedAt 근사 불가 →
     *  approvedAt − createdAt 근사(아래 주석). null = 승인 건 없음 */
    avgTurnaroundHours: number | null;
    /** 미결(PHOTOS_SUBMITTED) 건수 — 현재 시점(기간 무관 미결 잔량) */
    pendingCount: number;
    /** 반려율(%) = REJECTED / (제출 경험 = APPROVED+REJECTED+현재 SUBMITTED) 근사 */
    rejectRatePct: number;
  };
  // ── canViewFinance 전용(includeFinance=true) — false면 deposit 키 없음 ──
  deposit?: {
    /** PARTIAL_DEDUCTED 건수 */
    deductedCount: number;
    /** Σ depositDeductVnd */
    deductVnd: number;
    deductVndText: string;
  };
}

/**
 * loadOperationsStats — 홀드만료율·취소율·NO_SHOW율 + 청소검수(평균 처리시간·미결·반려율)
 * + includeFinance=true일 때만 보증금차감(건수·ΣVND, false면 deposit 키 자체 없음).
 *
 * ⚠️ 청소 평균 처리시간 한계: PHOTOS_SUBMITTED 전이 시각은 별도 컬럼이 없다. AuditLog로 정확
 *   복원 가능하나(상태전이 기록), 본 집계는 근사로 approvedAt − createdAt(태스크 생성→승인) 사용.
 *   updatedAt은 승인 시 함께 갱신되어 제출시각을 보존하지 못하므로 채택하지 않음(계약 §4.7 선언).
 *   정밀 처리시간은 후속 태스크(AuditLog 조인)로 분리.
 */
export async function loadOperationsStats(
  period: StatsPeriod,
  includeFinance: boolean,
  _now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<OperationsStats> {
  // 기간 내 생성 예약 — 홀드·취소·노쇼 비율 모집단
  const bookings = await db.booking.findMany({
    where: { createdAt: { gte: period.from, lt: period.to } },
    select: { status: true, depositStatus: true, depositDeductVnd: true },
  });

  // 홀드 만료율 — 분모 = HOLD로 생성되었던 예약 ≈ 현재 HOLD + EXPIRED (만료 자동 전이 반영)
  const holdCreatedCount = bookings.filter(
    (b) => b.status === BookingStatus.HOLD || b.status === BookingStatus.EXPIRED
  ).length;
  const holdExpiredCount = bookings.filter((b) => b.status === BookingStatus.EXPIRED).length;
  const holdExpiryPct = conversionRate(holdExpiredCount, holdCreatedCount);

  const cancelledCount = bookings.filter((b) => b.status === BookingStatus.CANCELLED).length;
  const cancelPct = conversionRate(cancelledCount, bookings.length);

  const checkedOutCount = bookings.filter((b) => b.status === BookingStatus.CHECKED_OUT).length;
  const noShowCount = bookings.filter((b) => b.status === BookingStatus.NO_SHOW).length;
  const noShowPct = conversionRate(noShowCount, checkedOutCount + noShowCount);

  // 청소 검수 — 기간 내 승인된 태스크의 평균 처리시간(근사) + 현재 미결 + 반려율
  const [approvedTasks, pendingCount, rejectedCount, submittedNowCount] = await Promise.all([
    db.cleaningTask.findMany({
      where: { approvedAt: { gte: period.from, lt: period.to } },
      select: { createdAt: true, approvedAt: true },
    }),
    db.cleaningTask.count({ where: { status: "PHOTOS_SUBMITTED" } }),
    db.cleaningTask.count({
      where: { status: "REJECTED", createdAt: { gte: period.from, lt: period.to } },
    }),
    db.cleaningTask.count({
      where: { status: "PHOTOS_SUBMITTED", createdAt: { gte: period.from, lt: period.to } },
    }),
  ]);

  let avgTurnaroundHours: number | null = null;
  if (approvedTasks.length > 0) {
    const totalMs = approvedTasks.reduce(
      (sum, t) => sum + (t.approvedAt!.getTime() - t.createdAt.getTime()),
      0
    );
    avgTurnaroundHours = Math.round((totalMs / approvedTasks.length / 3_600_000) * 10) / 10;
  }
  // 반려율 = REJECTED / (제출 경험 ≈ 기간 내 승인 + 반려 + 현재 제출). 분모 0이면 0.
  const submittedExperience = approvedTasks.length + rejectedCount + submittedNowCount;
  const rejectRatePct = conversionRate(rejectedCount, submittedExperience);

  const stats: OperationsStats = {
    holdExpiryPct,
    holdCreatedCount,
    holdExpiredCount,
    cancelPct,
    noShowPct,
    cleaning: {
      avgTurnaroundHours,
      pendingCount,
      rejectRatePct,
    },
  };

  if (includeFinance) {
    // BigInt 합산 후 마지막에 number/문자열 변환 (부동소수점 금지)
    let deductVndSum = 0n;
    let deductedCount = 0;
    for (const b of bookings) {
      if (b.depositStatus === "PARTIAL_DEDUCTED") {
        deductedCount += 1;
        deductVndSum += b.depositDeductVnd ?? 0n;
      }
    }
    const amt = toVndAmount(deductVndSum);
    stats.deposit = {
      deductedCount,
      deductVnd: amt.vnd,
      deductVndText: amt.vndText,
    };
  }

  return stats;
}

// ── 6. 미니바 통계 — canViewFinance 전용 (작업 C) ────────────────────
//
// CheckoutMinibarLine을 checkOutRecord→booking.checkOut 기준 [from, to)로 집계
// (매출 인식 = 체크아웃 — 다른 매출과 정합). 판매가·원가는 체크아웃 시점 스냅샷.
//   ★ 매출=재무 → canViewFinance 전용. 호출부 page.tsx에서 fin일 때만 호출.
//   ★ 원가(costVnd) 미입력 라인은 마진 계산에서 제외하고 costMissingCount로 분리 표기.

/** 버킷별 미니바 매출 추이 1행 (VND, 직렬화 쌍) */
export interface MinibarTrendPoint {
  bucketKey: string;
  label: string;
  revenueVnd: number;
  revenueVndText: string;
}

/** 품목별 인기/매출 1행 (소모수량합·매출합 내림차순) */
export interface MinibarItemStat {
  /** 품목명 스냅샷(nameKo) — 품목 삭제돼도 라인에 보존 */
  nameKo: string;
  /** 소모 수량 합 */
  consumedQty: number;
  revenueVnd: number;
  revenueVndText: string;
}

export interface MinibarStats {
  /** 총 미니바 매출(VND) */
  revenueVnd: number;
  revenueVndText: string;
  /** 버킷별 매출 추이 */
  trend: MinibarTrendPoint[];
  /** 품목별 top(매출 내림차순) */
  topItems: MinibarItemStat[];
  /**
   * 미니바 마진(VND) = Σ(원가있는 라인 lineVnd) − Σ lineCostVnd. 음수(역마진) 보존.
   * 원가 입력 라인이 하나도 없으면 null → "원가 미입력" 표기.
   */
  marginVnd: number | null;
  marginVndText: string | null;
  /** 원가(costVnd) 미입력 라인 수 — 마진에서 제외된 라인 카운트 */
  costMissingCount: number;
}

interface MinibarLineRow {
  nameKo: string;
  consumedQty: number;
  lineVnd: bigint;
  costVnd: bigint | null;
  lineCostVnd: bigint | null;
  checkOut: Date;
}

/**
 * loadMinibarStats — 미니바 매출·품목 인기·마진 집계 (canViewFinance 전용).
 * 체크아웃일(booking.checkOut) [from, to) 기준. 버킷별 추이는 period.buckets 순회.
 * BigInt 합산 후 마지막에 number/문자열 변환(부동소수점 금지). 매출액은 안전정수 범위 내.
 */
export async function loadMinibarStats(
  period: StatsPeriod,
  _now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<MinibarStats> {
  const lines = await db.checkoutMinibarLine.findMany({
    where: {
      checkOutRecord: {
        booking: { checkOut: { gte: period.from, lt: period.to } },
      },
    },
    select: {
      nameKo: true,
      consumedQty: true,
      lineVnd: true,
      costVnd: true,
      lineCostVnd: true,
      checkOutRecord: { select: { booking: { select: { checkOut: true } } } },
    },
  });

  const rows: MinibarLineRow[] = lines.map((l) => ({
    nameKo: l.nameKo,
    consumedQty: l.consumedQty,
    lineVnd: l.lineVnd,
    costVnd: l.costVnd,
    lineCostVnd: l.lineCostVnd,
    checkOut: l.checkOutRecord.booking.checkOut,
  }));

  // 총 매출 (BigInt 합산)
  let totalRevenue = 0n;
  for (const r of rows) totalRevenue += r.lineVnd;
  const revAmt = toVndAmount(totalRevenue);

  // 버킷별 매출 추이
  const trend: MinibarTrendPoint[] = period.buckets.map((bucket) => {
    let sum = 0n;
    for (const r of rows) {
      const t = r.checkOut.getTime();
      if (t >= bucket.start.getTime() && t < bucket.end.getTime()) sum += r.lineVnd;
    }
    const amt = toVndAmount(sum);
    return {
      bucketKey: bucket.key,
      label: bucket.label,
      revenueVnd: amt.vnd,
      revenueVndText: amt.vndText,
    };
  });

  // 품목별 top — nameKo 스냅샷별 소모수량·매출 합산
  const byName = new Map<string, { consumedQty: number; revenue: bigint }>();
  for (const r of rows) {
    const cur = byName.get(r.nameKo) ?? { consumedQty: 0, revenue: 0n };
    cur.consumedQty += r.consumedQty;
    cur.revenue += r.lineVnd;
    byName.set(r.nameKo, cur);
  }
  const topItems: MinibarItemStat[] = [...byName.entries()]
    .map(([nameKo, v]) => {
      const amt = toVndAmount(v.revenue);
      return {
        nameKo,
        consumedQty: v.consumedQty,
        revenueVnd: amt.vnd,
        revenueVndText: amt.vndText,
      };
    })
    .sort((a, b) => b.revenueVnd - a.revenueVnd || b.consumedQty - a.consumedQty);

  // 마진 — 원가(costVnd) 스냅샷이 있는 라인만 합산. 역마진(음수) 보존.
  //   원가 입력 라인이 0이면 margin=null("원가 미입력"). costVnd 없는 라인은 costMissingCount.
  let marginRevenue = 0n; // Σ lineVnd (원가있는 라인만)
  let marginCost = 0n; // Σ lineCostVnd
  let costPresentCount = 0;
  let costMissingCount = 0;
  for (const r of rows) {
    if (r.costVnd != null && r.lineCostVnd != null) {
      marginRevenue += r.lineVnd;
      marginCost += r.lineCostVnd;
      costPresentCount += 1;
    } else {
      costMissingCount += 1;
    }
  }
  let marginVnd: number | null = null;
  let marginVndText: string | null = null;
  if (costPresentCount > 0) {
    const m = toVndAmount(marginRevenue - marginCost);
    marginVnd = m.vnd;
    marginVndText = m.vndText;
  }

  return {
    revenueVnd: revAmt.vnd,
    revenueVndText: revAmt.vndText,
    trend,
    topItems,
    marginVnd,
    marginVndText,
    costMissingCount,
  };
}
