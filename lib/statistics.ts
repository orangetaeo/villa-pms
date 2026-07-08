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
  ServiceOrderStatus,
  type ServiceType,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatThousands, formatVnd } from "@/lib/format";
import { krwApproxText } from "@/lib/money-display";
import { getFxVndPerKrw } from "@/lib/pricing";
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
  /** Phase 2 USD — 옵셔널(실제 stats 쿼리는 select하지만 KRW/VND-only 호출/픽스처 호환) */
  totalSaleUsd?: number | null;
  supplierCostVnd: bigint;
  fxVndPerKrw: { toString(): string } | null;
  fxVndPerUsd?: { toString(): string } | null;
}

export function toFinanceBooking(b: FinanceSourceRow): FinanceBooking {
  return {
    saleCurrency: b.saleCurrency,
    totalSaleKrw: b.totalSaleKrw,
    totalSaleVnd: b.totalSaleVnd,
    totalSaleUsd: b.totalSaleUsd,
    supplierCostVnd: b.supplierCostVnd,
    fxVndPerKrw: b.fxVndPerKrw != null ? b.fxVndPerKrw.toString() : null,
    // Phase 2 USD: 예약 시점 USD→VND 스냅샷(없으면 fxMissing). bookingFinance가 USD 환산 처리.
    fxVndPerUsd: b.fxVndPerUsd != null ? b.fxVndPerUsd.toString() : null,
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

/**
 * OverviewStats — 개요 탭 집계.
 *
 * ★ 통합 총계: trend(버킷별)·current(기간 총계·직전 동기간 대비)의 매출·마진은
 *   **빌라 + 부가서비스(ServiceOrder) + 미니바(CheckoutMinibarLine) 합산**이다.
 *   - KRW 매출 = 빌라 collectedKrw + 부가서비스 priceKrw
 *   - VND 매출 = 빌라 collectedVnd + 미니바 lineVnd + 부가서비스 priceVnd
 *   - 마진(VND) = 빌라 marginVnd + 미니바 마진(원가 라인) + 부가서비스 마진(원가&VND 라인)
 *   통화(KRW·VND)는 절대 한 숫자로 합치지 않는다(ADR-0003). marginRatePct 분모는 VND 기준
 *   (빌라 collectedVndEquivalent + 미니바 VND + 부가서비스 VND) — KRW 매출은 환산 없이 제외.
 * ★ channels(채널 도넛)는 **빌라 예약 기준 유지**(부가서비스·미니바 미반영).
 * ★ RevenueTrendPoint/RevenueKpi 인터페이스는 그대로(필드 추가 없음 — 값만 통합).
 */
/** 통합 합산표의 한 행(소스별/합계) — 통화 분리(KRW·VND·USD), VND 마진. */
export interface IntegratedLine {
  krwRevenue: number;
  krwRevenueText: string;
  vndRevenue: number;
  vndRevenueText: string;
  /** USD 원본 매출(빌라 객실 USD 예약만, 부가·미니바는 0) — Phase 2 */
  usdRevenue: number;
  usdRevenueText: string;
  marginVnd: number;
  marginVndText: string;
}

/** 통합 합산표 — 빌라 + 부가서비스 + 미니바 소스별 + 합계(기간 [from,to)). 개요와 별개 표. */
export interface IntegratedBreakdown {
  villa: IntegratedLine;
  services: IntegratedLine;
  minibar: IntegratedLine;
  total: IntegratedLine & {
    /** 합계 마진율(%) = 통합 마진 / (빌라 VND환산 + 부가·미니바 VND) */
    marginRatePct: number | null;
    /** 환율 미기록으로 환산·마진서 제외된 KRW 빌라 예약 수 */
    fxMissingCount: number;
    /** ★통합 환산 매출(VND) = 빌라 VND환산(KRW·USD 포함) + 부가·미니바 VND. 나이키식 헤드라인 기준 */
    vndEquivalent: number;
    vndEquivalentText: string;
    /** 통합 환산 매출의 원화 근사 "≈ ₩…" (환율 없으면 null) */
    krwApproxText: string | null;
    /** 환산 마진의 원화 근사 "≈ ₩…" (환율 없으면 null) */
    marginKrwApproxText: string | null;
  };
}

export interface OverviewStats {
  /** 버킷 키 배열(차트 x축 순서) */
  bucketKeys: string[];
  trend: RevenueTrendPoint[];
  /** 기간 총계 KPI(+ 직전 동기간 대비) — ★순수 빌라(객실)만. 부가·미니바는 integrated 별도 표 */
  current: RevenueKpi;
  /** 채널별(빌라 예약 기준) */
  channels: ChannelStat[];
  /** 통합 합산표(빌라+부가서비스+미니바 소스별·합계) — 개요와 별개 (기간 [from,to)) */
  integrated: IntegratedBreakdown;
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
  totalSaleUsd: true,
  supplierCostVnd: true,
  fxVndPerKrw: true,
  fxVndPerUsd: true,
} as const;

/** [start, end) 내 행만 필터 (체크아웃 @db.Date UTC 경계) */
function rowsInRange<T extends { checkOut: Date }>(rows: T[], start: Date, end: Date): T[] {
  return rows.filter(
    (r) => r.checkOut.getTime() >= start.getTime() && r.checkOut.getTime() < end.getTime()
  );
}

// ── 개요 통합용 부가서비스·미니바 보조 집계 (작업: 개요=빌라+부가서비스+미니바 합산) ──
//
// loadMinibarStats·loadServiceOrderStats는 무수정(상세 탭이 그대로 detail로 씀). 개요 KPI/추이는
// 그 함수들과 "동일 규칙"으로 라인을 합산하기 위해, 같은 매출인식(체크아웃일)·통화분리·마진규칙을
// 적용하는 경량 헬퍼를 별도로 둔다(전체 통계 함수를 재호출하지 않고 버킷별 부분합만 필요하므로).

/** 미니바 라인 1행 — checkOut(=booking.checkOut)으로 버킷 귀속 */
interface MinibarContribRow {
  lineVnd: bigint;
  /** 원가 스냅샷 있는 라인만 마진 산입 (loadMinibarStats와 동일: costVnd & lineCostVnd 둘 다 not null) */
  costVnd: bigint | null;
  lineCostVnd: bigint | null;
  checkOut: Date;
}

/** 부가서비스 라인 1행 — checkOut(=booking.checkOut)으로 버킷 귀속 */
interface ServiceContribRow {
  priceKrw: number;
  priceVnd: bigint | null;
  costVnd: bigint;
  checkOut: Date;
}

const MINIBAR_CONTRIB_SELECT = {
  lineVnd: true,
  costVnd: true,
  lineCostVnd: true,
  checkOutRecord: { select: { booking: { select: { checkOut: true } } } },
} as const;

const SERVICE_CONTRIB_SELECT = {
  priceKrw: true,
  priceVnd: true,
  costVnd: true,
  booking: { select: { checkOut: true } },
} as const;

/** 한 소스(부가서비스/미니바)의 범위 기여 — 통화 분리(KRW·VND 미합산), 마진은 VND. */
interface SourceContrib {
  /** KRW 매출 합(부가서비스만, 미니바는 0) */
  krw: number;
  /** VND 매출 합 */
  vnd: bigint;
  /** VND 마진 합 (원가 있는 라인만, KRW 라인 제외 — ADR-0003) */
  marginVnd: bigint;
}

/**
 * serviceContribInRange — [start, end) 부가서비스(ServiceOrder) 기여.
 *   VND 매출 = Σ priceVnd(not null), KRW 매출 = Σ priceKrw, 마진 = Σ(priceVnd−costVnd) (costVnd>0 라인).
 */
function serviceContribInRange(services: ServiceContribRow[], start: Date, end: Date): SourceContrib {
  let krw = 0;
  let vnd = 0n;
  let marginVnd = 0n;
  for (const r of rowsInRange(services, start, end)) {
    krw += r.priceKrw;
    if (r.priceVnd != null) {
      vnd += r.priceVnd;
      if (r.costVnd > 0n) marginVnd += r.priceVnd - r.costVnd;
    }
  }
  return { krw, vnd, marginVnd };
}

/**
 * minibarContribInRange — [start, end) 미니바(CheckoutMinibarLine) 기여. KRW 없음.
 *   VND 매출 = Σ lineVnd, 마진 = Σ(lineVnd−lineCostVnd) (원가 있는 라인).
 */
function minibarContribInRange(minibar: MinibarContribRow[], start: Date, end: Date): SourceContrib {
  let vnd = 0n;
  let marginVnd = 0n;
  for (const r of rowsInRange(minibar, start, end)) {
    vnd += r.lineVnd;
    if (r.costVnd != null && r.lineCostVnd != null) marginVnd += r.lineVnd - r.lineCostVnd;
  }
  return { krw: 0, vnd, marginVnd };
}

/**
 * loadOverviewStats — 재무 전용(canViewFinance 게이트는 호출부(page.tsx)에서 확인 후 호출).
 * 버킷별 매출추이 + 기간 총계 KPI(직전 동기간 대비) + 채널별 건수·매출.
 *
 * ★ trend/current/channels = **순수 빌라(객실)** 매출·마진만(부가서비스·미니바 제외).
 *   부가서비스·미니바를 포함한 통합 합산은 별도 필드 `integrated`(소스별·합계)로 제공한다.
 *   통화 분리 유지(KRW·VND 미합산, ADR-0003). 빌라 마진 환산은 summarizeFinance.
 * 매출 인식 = 체크아웃일. 빌라·부가서비스 모두 예약 SETTLEMENT_BOOKING_STATUSES 게이트 /
 *   부가서비스는 추가로 주문상태 CONFIRMED·DELIVERED / 미니바=전체 라인(체크아웃 발생분).
 */
export async function loadOverviewStats(
  period: StatsPeriod,
  _now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<OverviewStats> {
  // 나이키식 통합 환산 매출/마진의 원화 근사 표기용 — 현재 FX_VND_PER_KRW(없으면 ≈₩ 숨김).
  //   설정 부재·조회 실패는 ≈₩ 생략으로 degrade(통계 본체는 영향 없음).
  const fxVndPerKrw = await getFxVndPerKrw(db).catch(() => null);
  // 추이·총계 + 직전 동기간 KPI를 위해 previous.from(있으면)까지 한 번에 조회
  const queryStart = period.previous ? period.previous.from : period.from;

  // 빌라 매출(booking) + 부가서비스(ServiceOrder) + 미니바(CheckoutMinibarLine)를
  //   동일 윈도우 [queryStart, period.to)로 병렬 조회. 이후 rowsInRange로 버킷/기간/직전 클리핑.
  const [rows, serviceRowsRaw, minibarRowsRaw] = await Promise.all([
    db.booking.findMany({
      where: {
        status: { in: SETTLEMENT_STATUS_FILTER },
        checkOut: { gte: queryStart, lt: period.to },
      },
      select: REVENUE_SELECT,
    }) as Promise<RevenueSourceRow[]>,
    db.serviceOrder.findMany({
      where: {
        status: { in: [ServiceOrderStatus.CONFIRMED, ServiceOrderStatus.DELIVERED] },
        // 매출 인식 = 체크아웃일 → 예약이 실제 정산 상태(CHECKED_OUT·NO_SHOW)일 때만.
        //   ROOM·revenue-ledger와 동일 게이트(체크아웃 안 된 CONFIRMED 예약의 부가매출 조기인식 방지).
        booking: {
          status: { in: SETTLEMENT_STATUS_FILTER },
          checkOut: { gte: queryStart, lt: period.to },
        },
      },
      select: SERVICE_CONTRIB_SELECT,
    }),
    db.checkoutMinibarLine.findMany({
      where: {
        checkOutRecord: {
          booking: { checkOut: { gte: queryStart, lt: period.to } },
        },
      },
      select: MINIBAR_CONTRIB_SELECT,
    }),
  ]);

  // 부가서비스·미니바 라인을 checkOut 평탄화(버킷 귀속용)
  const serviceRows: ServiceContribRow[] = serviceRowsRaw.map((o) => ({
    priceKrw: o.priceKrw,
    priceVnd: o.priceVnd,
    costVnd: o.costVnd,
    checkOut: o.booking.checkOut,
  }));
  const minibarRows: MinibarContribRow[] = minibarRowsRaw.map((l) => ({
    lineVnd: l.lineVnd,
    costVnd: l.costVnd,
    lineCostVnd: l.lineCostVnd,
    checkOut: l.checkOutRecord.booking.checkOut,
  }));

  const inPeriodRows = rowsInRange(rows, period.from, period.to);

  /** 한 범위 [start, end)의 ★순수 빌라(객실) 매출·마진 블록. 부가서비스·미니바는 제외(통합표는 별도). */
  function villaBlock(start: Date, end: Date): {
    krwRevenue: number;
    vndRevenue: bigint;
    usdRevenue: number;
    marginVnd: bigint;
    /** marginRatePct 분모(VND): 빌라 환산(collectedVndEquivalent) */
    vndDenominator: bigint;
    fxMissingCount: number;
  } {
    const villaList = rowsInRange(rows, start, end);
    const s = summarizeFinance(villaList.map(toFinanceBooking));
    return {
      krwRevenue: s.collectedKrw,
      vndRevenue: s.collectedVnd,
      usdRevenue: s.collectedUsd,
      marginVnd: s.marginVnd,
      vndDenominator: s.collectedVndEquivalent,
      fxMissingCount: s.fxMissingCount,
    };
  }

  /** 통합 블록 → 직렬화 쌍(KRW·VND·마진 텍스트, marginRatePct). 통화 분리 유지. */
  function toIntegratedFields(b: ReturnType<typeof villaBlock>) {
    const krw = toKrwAmount(b.krwRevenue);
    const vnd = toVndAmount(b.vndRevenue);
    const margin = toVndAmount(b.marginVnd);
    // 마진율 = 통합 마진VND / 통합 VND분모 × 100. 분모 0이면 null(÷0 방지). KRW 매출은 분모/마진서 제외.
    const marginRatePct =
      b.vndDenominator > 0n
        ? Math.round((Number(b.marginVnd) / Number(b.vndDenominator)) * 1000) / 10
        : null;
    return {
      krwRevenue: krw.krw,
      krwRevenueText: krw.krwText,
      vndRevenue: vnd.vnd,
      vndRevenueText: vnd.vndText,
      marginVnd: margin.vnd,
      marginVndText: margin.vndText,
      marginRatePct,
      fxMissingCount: b.fxMissingCount,
    };
  }

  // 버킷별 추이 — period.buckets 순회([start, end) 클리핑), 통합 합산
  const trend: RevenueTrendPoint[] = period.buckets.map((bucket) => {
    const f = toIntegratedFields(villaBlock(bucket.start, bucket.end));
    return {
      bucketKey: bucket.key,
      label: bucket.label,
      krwRevenue: f.krwRevenue,
      krwRevenueText: f.krwRevenueText,
      vndRevenue: f.vndRevenue,
      vndRevenueText: f.vndRevenueText,
      marginVnd: f.marginVnd,
      marginVndText: f.marginVndText,
      fxMissingCount: f.fxMissingCount,
    };
  });

  // 기간 총계 KPI + 직전 동기간 대비 — 모두 통합 합산 기준
  const currentFields = toIntegratedFields(villaBlock(period.from, period.to));
  const prevFields = period.previous
    ? toIntegratedFields(villaBlock(period.previous.from, period.previous.to))
    : null;

  const current: RevenueKpi = {
    krwRevenue: currentFields.krwRevenue,
    krwRevenueText: currentFields.krwRevenueText,
    vndRevenue: currentFields.vndRevenue,
    vndRevenueText: currentFields.vndRevenueText,
    marginVnd: currentFields.marginVnd,
    marginVndText: currentFields.marginVndText,
    marginRatePct: currentFields.marginRatePct,
    fxMissingCount: currentFields.fxMissingCount,
    krwChangePct: prevFields ? changeRate(currentFields.krwRevenue, prevFields.krwRevenue) : null,
    vndChangePct: prevFields ? changeRate(currentFields.vndRevenue, prevFields.vndRevenue) : null,
    marginChangePct: prevFields ? changeRate(currentFields.marginVnd, prevFields.marginVnd) : null,
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

  // 통합 합산표(빌라+부가서비스+미니바) — 기간 [from,to) 소스별·합계. 개요(빌라 전용)와 별개.
  const villaSummary = summarizeFinance(inPeriodRows.map(toFinanceBooking));
  const svc = serviceContribInRange(serviceRows, period.from, period.to);
  const mb = minibarContribInRange(minibarRows, period.from, period.to);

  // USD는 빌라 객실 예약에만 존재(부가·미니바는 KRW·VND뿐) → svc/mb usd=0.
  const line = (krw: number, vnd: bigint, usd: number, margin: bigint): IntegratedLine => {
    const k = toKrwAmount(krw);
    const v = toVndAmount(vnd);
    const m = toVndAmount(margin);
    return {
      krwRevenue: k.krw, krwRevenueText: k.krwText,
      vndRevenue: v.vnd, vndRevenueText: v.vndText,
      usdRevenue: usd, usdRevenueText: `$${formatThousands(usd)}`,
      marginVnd: m.vnd, marginVndText: m.vndText,
    };
  };
  const totalKrw = villaSummary.collectedKrw + svc.krw;
  const totalVnd = villaSummary.collectedVnd + svc.vnd + mb.vnd;
  const totalUsd = villaSummary.collectedUsd; // USD는 빌라 객실만
  const totalMargin = villaSummary.marginVnd + svc.marginVnd + mb.marginVnd;
  const totalDenom = villaSummary.collectedVndEquivalent + svc.vnd + mb.vnd; // 빌라 VND환산(KRW·USD 포함) + 부가·미니바 VND
  const totalDenomAmt = toVndAmount(totalDenom);
  const integrated: IntegratedBreakdown = {
    villa: line(villaSummary.collectedKrw, villaSummary.collectedVnd, villaSummary.collectedUsd, villaSummary.marginVnd),
    services: line(svc.krw, svc.vnd, 0, svc.marginVnd),
    minibar: line(mb.krw, mb.vnd, 0, mb.marginVnd),
    total: {
      ...line(totalKrw, totalVnd, totalUsd, totalMargin),
      marginRatePct: totalDenom > 0n ? Math.round((Number(totalMargin) / Number(totalDenom)) * 1000) / 10 : null,
      fxMissingCount: villaSummary.fxMissingCount,
      // ★나이키식 헤드라인: 통합 환산 매출(VND) + 원화 근사 / 환산 마진 원화 근사
      vndEquivalent: totalDenomAmt.vnd,
      vndEquivalentText: totalDenomAmt.vndText,
      krwApproxText: krwApproxText(totalDenom, fxVndPerKrw),
      marginKrwApproxText: krwApproxText(totalMargin, fxVndPerKrw),
    },
  };

  return {
    bucketKeys: period.buckets.map((b) => b.key),
    trend,
    current,
    channels,
    integrated,
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
          totalSaleUsd: true,
          supplierCostVnd: true,
          fxVndPerKrw: true,
          fxVndPerUsd: true,
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

// ── 7. 부가서비스(ServiceOrder) 매출 통계 — canViewFinance 전용 (ADR-0019 후속) ──
//
// ServiceOrder를 booking.checkOut 기준 [from, to)로 집계(매출 인식 = 체크아웃 — 미니바·정산과 정합).
// CONFIRMED·DELIVERED 상태만(REQUESTED=미확정, CANCELLED=취소 제외).
//   ★ 매출=재무 → canViewFinance 전용. 호출부 page.tsx에서 fin일 때만 호출.
//   ★ 통화 분리(ADR-0003): 판매가 KRW(priceKrw, 여행사 채널)와 VND(priceVnd, 현지)는 절대 합산 금지 —
//     각 통화별 합·추이를 별도 계열로 유지. 마진은 원가가 VND(costVnd)뿐이므로 VND 라인만 산출.
//   ★ 원가(costVnd) 미입력(=0/null) 라인은 마진에서 제외하고 costMissingCount로 분리 표기.

/** 버킷별 부가서비스 매출 추이 1행 (KRW·VND 2계열, 직렬화 쌍) */
export interface ServiceTrendPoint {
  bucketKey: string;
  label: string;
  revenueKrw: number;
  revenueKrwText: string;
  revenueVnd: number;
  revenueVndText: string;
}

/** 타입(ServiceType)별 매출 1행 (KRW·VND 분리, 합산 금지) */
export interface ServiceTypeStat {
  type: ServiceType;
  /** 주문 건수 합(quantity 합) */
  quantity: number;
  revenueKrw: number;
  revenueKrwText: string;
  revenueVnd: number;
  revenueVndText: string;
}

/** 카탈로그 품목별 매출 1행 (어떤 티켓·메뉴가 많이 팔렸나) — KRW·VND 분리 */
export interface ServiceItemStat {
  itemId: string;
  /** 카탈로그명(nameKo) — 운영자 표시 */
  label: string;
  type: ServiceType;
  /** 판매 수량 합(예: 티켓 매수) */
  quantity: number;
  revenueKrw: number;
  revenueKrwText: string;
  revenueVnd: number;
  revenueVndText: string;
}

/** 거래처(ServiceVendor)별 이용 1행 (어떤 업체를 많이 이용했나) — 매출(판매가)·지급(원가) 분리 */
export interface ServiceVendorStat {
  vendorId: string;
  name: string;
  /** 발주(주문) 건수 */
  orderCount: number;
  quantity: number;
  /** 판매가 매출(KRW·VND 분리) */
  revenueKrw: number;
  revenueKrwText: string;
  revenueVnd: number;
  revenueVndText: string;
  /** 우리가 이 업체에 지급한 금액(원가 합, VND) */
  payoutVnd: number;
  payoutVndText: string;
}

export interface ServiceOrderStats {
  /** 총 부가서비스 매출 — 통화별 분리(합산 금지) */
  revenueKrw: number;
  revenueKrwText: string;
  revenueVnd: number;
  revenueVndText: string;
  /** 버킷별 매출 추이(KRW·VND 2계열) */
  trend: ServiceTrendPoint[];
  /** 타입별 매출 top(VND→KRW 내림차순) */
  topTypes: ServiceTypeStat[];
  /** 품목별 매출 top(어떤 티켓·메뉴가 많이 팔렸나, VND→KRW 내림차순) */
  topItems: ServiceItemStat[];
  /** 거래처별 이용 top(어떤 업체를 많이 이용했나, VND 매출 내림차순) */
  topVendors: ServiceVendorStat[];
  /**
   * 부가서비스 마진(VND) = Σ(원가있는 라인 priceVnd) − Σ(원가있는 라인 costVnd). 음수(역마진) 보존.
   * 원가(costVnd>0) & priceVnd 있는 라인이 하나도 없으면 null → "원가 미입력" 표기.
   *   ★ 마진은 VND만(원가가 VND뿐) — KRW 매출 라인은 환산 없이 마진에서 제외(ADR-0003).
   */
  marginVnd: number | null;
  marginVndText: string | null;
  /** 원가(costVnd) 미입력(0/null) 라인 수 — 마진에서 제외된 라인 카운트 */
  costMissingCount: number;
}

interface ServiceLineRow {
  type: ServiceType;
  priceKrw: number;
  priceVnd: bigint | null;
  costVnd: bigint;
  quantity: number;
  checkOut: Date;
  catalogItemId: string | null;
  vendorId: string | null;
  vendorName: string | null;
}

/**
 * loadServiceOrderStats — 부가서비스 매출·타입별 인기·마진 집계 (canViewFinance 전용).
 * 체크아웃일(booking.checkOut) [from, to) 기준. 예약 SETTLEMENT_BOOKING_STATUSES 게이트 +
 *   주문상태 CONFIRMED·DELIVERED만(revenue-ledger·ROOM 정합).
 * 통화(KRW·VND) 별도 합산(합치지 않음, ADR-0003). BigInt 합산 후 number/문자열 변환.
 *   priceKrw·quantity는 라인 합(priceKrw는 단가가 아닌 라인 스냅샷 합계로 취급 — 미니바 lineVnd와 동형).
 */
export async function loadServiceOrderStats(
  period: StatsPeriod,
  _now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<ServiceOrderStats> {
  const orders = await db.serviceOrder.findMany({
    where: {
      status: { in: [ServiceOrderStatus.CONFIRMED, ServiceOrderStatus.DELIVERED] },
      // 매출 인식 = 체크아웃일 → 예약이 정산 상태(CHECKED_OUT·NO_SHOW)일 때만(ROOM·revenue-ledger 정합).
      booking: {
        status: { in: SETTLEMENT_STATUS_FILTER },
        checkOut: { gte: period.from, lt: period.to },
      },
    },
    select: {
      type: true,
      priceKrw: true,
      priceVnd: true,
      costVnd: true,
      quantity: true,
      catalogItemId: true,
      vendorId: true,
      vendor: { select: { name: true } },
      booking: { select: { checkOut: true } },
    },
  });

  // 카탈로그 품목명 — catalogItemId는 관계 미정의 스칼라이므로 일괄 조회 후 매핑(vendor orders 패턴).
  const itemIds = Array.from(new Set(orders.map((o) => o.catalogItemId).filter((v): v is string => !!v)));
  const catItems = itemIds.length
    ? await db.serviceCatalogItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameKo: true } })
    : [];
  const itemNameById = new Map(catItems.map((i) => [i.id, i.nameKo]));

  const rows: ServiceLineRow[] = orders.map((o) => ({
    type: o.type,
    priceKrw: o.priceKrw,
    priceVnd: o.priceVnd,
    costVnd: o.costVnd,
    quantity: o.quantity,
    checkOut: o.booking.checkOut,
    catalogItemId: o.catalogItemId,
    vendorId: o.vendorId,
    vendorName: o.vendor?.name ?? null,
  }));

  // 총 매출 — 통화별 분리 합산(절대 합치지 않음). KRW=Int 합(number), VND=BigInt 합.
  let totalKrw = 0;
  let totalVnd = 0n;
  for (const r of rows) {
    totalKrw += r.priceKrw;
    if (r.priceVnd != null) totalVnd += r.priceVnd;
  }
  const krwAmt = toKrwAmount(totalKrw);
  const vndAmt = toVndAmount(totalVnd);

  // 버킷별 매출 추이 — KRW·VND 2계열
  const trend: ServiceTrendPoint[] = period.buckets.map((bucket) => {
    let kSum = 0;
    let vSum = 0n;
    for (const r of rows) {
      const t = r.checkOut.getTime();
      if (t >= bucket.start.getTime() && t < bucket.end.getTime()) {
        kSum += r.priceKrw;
        if (r.priceVnd != null) vSum += r.priceVnd;
      }
    }
    const k = toKrwAmount(kSum);
    const v = toVndAmount(vSum);
    return {
      bucketKey: bucket.key,
      label: bucket.label,
      revenueKrw: k.krw,
      revenueKrwText: k.krwText,
      revenueVnd: v.vnd,
      revenueVndText: v.vndText,
    };
  });

  // 타입별 top — ServiceType별 수량·매출(통화 분리) 합산
  const byType = new Map<ServiceType, { quantity: number; krw: number; vnd: bigint }>();
  for (const r of rows) {
    const cur = byType.get(r.type) ?? { quantity: 0, krw: 0, vnd: 0n };
    cur.quantity += r.quantity;
    cur.krw += r.priceKrw;
    if (r.priceVnd != null) cur.vnd += r.priceVnd;
    byType.set(r.type, cur);
  }
  const topTypes: ServiceTypeStat[] = [...byType.entries()]
    .map(([type, v]) => {
      const k = toKrwAmount(v.krw);
      const a = toVndAmount(v.vnd);
      return {
        type,
        quantity: v.quantity,
        revenueKrw: k.krw,
        revenueKrwText: k.krwText,
        revenueVnd: a.vnd,
        revenueVndText: a.vndText,
      };
    })
    .sort((a, b) => b.revenueVnd - a.revenueVnd || b.revenueKrw - a.revenueKrw);

  // 품목별 top — 어떤 티켓·메뉴가 많이 팔렸나(catalogItemId 기준). 카탈로그 미연결 라인은 제외.
  const byItem = new Map<string, { type: ServiceType; quantity: number; krw: number; vnd: bigint }>();
  for (const r of rows) {
    if (!r.catalogItemId) continue;
    const cur = byItem.get(r.catalogItemId) ?? { type: r.type, quantity: 0, krw: 0, vnd: 0n };
    cur.quantity += r.quantity;
    cur.krw += r.priceKrw;
    if (r.priceVnd != null) cur.vnd += r.priceVnd;
    byItem.set(r.catalogItemId, cur);
  }
  const topItems: ServiceItemStat[] = [...byItem.entries()]
    .map(([itemId, v]) => {
      const k = toKrwAmount(v.krw);
      const a = toVndAmount(v.vnd);
      return {
        itemId,
        label: itemNameById.get(itemId) ?? itemId,
        type: v.type,
        quantity: v.quantity,
        revenueKrw: k.krw,
        revenueKrwText: k.krwText,
        revenueVnd: a.vnd,
        revenueVndText: a.vndText,
      };
    })
    .sort((a, b) => b.revenueVnd - a.revenueVnd || b.revenueKrw - a.revenueKrw)
    .slice(0, 10);

  // 거래처별 top — 어떤 업체를 많이 이용했나(vendorId 기준). 직접제공(업체 없음)은 제외.
  const byVendor = new Map<string, { name: string; orderCount: number; quantity: number; krw: number; vnd: bigint; payout: bigint }>();
  for (const r of rows) {
    if (!r.vendorId) continue;
    const cur = byVendor.get(r.vendorId) ?? { name: r.vendorName ?? r.vendorId, orderCount: 0, quantity: 0, krw: 0, vnd: 0n, payout: 0n };
    cur.orderCount += 1;
    cur.quantity += r.quantity;
    cur.krw += r.priceKrw;
    if (r.priceVnd != null) cur.vnd += r.priceVnd;
    cur.payout += r.costVnd;
    byVendor.set(r.vendorId, cur);
  }
  const topVendors: ServiceVendorStat[] = [...byVendor.entries()]
    .map(([vendorId, v]) => {
      const k = toKrwAmount(v.krw);
      const a = toVndAmount(v.vnd);
      const p = toVndAmount(v.payout);
      return {
        vendorId,
        name: v.name,
        orderCount: v.orderCount,
        quantity: v.quantity,
        revenueKrw: k.krw,
        revenueKrwText: k.krwText,
        revenueVnd: a.vnd,
        revenueVndText: a.vndText,
        payoutVnd: p.vnd,
        payoutVndText: p.vndText,
      };
    })
    .sort((a, b) => b.revenueVnd - a.revenueVnd || b.orderCount - a.orderCount)
    .slice(0, 10);

  // 마진(VND만) — costVnd>0 & priceVnd 있는 라인만. 역마진(음수) 보존.
  //   costVnd=0(placeholder)/priceVnd 없음 라인은 costMissingCount.
  let marginRevenue = 0n; // Σ priceVnd (원가있는 VND 라인)
  let marginCost = 0n; // Σ costVnd
  let costPresentCount = 0;
  let costMissingCount = 0;
  for (const r of rows) {
    if (r.costVnd > 0n && r.priceVnd != null) {
      marginRevenue += r.priceVnd;
      marginCost += r.costVnd;
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
    revenueKrw: krwAmt.krw,
    revenueKrwText: krwAmt.krwText,
    revenueVnd: vndAmt.vnd,
    revenueVndText: vndAmt.vndText,
    trend,
    topTypes,
    topItems,
    topVendors,
    marginVnd,
    marginVndText,
    costMissingCount,
  };
}
