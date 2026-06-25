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
  ProposalStatus,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatThousands, formatVnd } from "@/lib/format";
import { monthRangeUtc, SETTLEMENT_BOOKING_STATUSES } from "@/lib/settlement";
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
import { monthKeyVn } from "@/lib/cleaning";

// ===================================================================
// 순수 함수 층 (단위 테스트 대상 — DB 무관)
// ===================================================================

/** 기간 필터 — 최근 6/12개월 또는 특정 연도(12개월). 계약 §5 우상단 기간 필터. */
export type StatsRange = "6" | "12" | { year: number };

const MS_PER_DAY = 86_400_000;

/** range 파싱 결과 — 월키 배열(과거→현재 정렬)과 전체 [start, end) UTC 창. */
export interface RangePeriod {
  /** "YYYY-MM" 오름차순(가장 오래된 달 → 최신 달) */
  monthKeys: string[];
  /** 가장 오래된 달의 1일 UTC 자정 */
  start: Date;
  /** 가장 최신 달의 익월 1일 UTC 자정 (exclusive) */
  end: Date;
}

/** "YYYY-MM" → 그 달 1일 UTC 자정 Date (월키 산술용 내부 헬퍼) */
function monthKeyToUtcStart(monthKey: string): Date {
  // monthRangeUtc는 형식 검증 포함 — 재사용으로 정합 유지
  return monthRangeUtc(monthKey).start;
}

/** UTC 자정 Date → "YYYY-MM" (월키. range 산출 내부용) */
function utcMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * range → 월키 배열 + 전체 창. 순수 함수(테스트 대상).
 * - "6"/"12": now가 속한 달을 포함해 과거 N개월(오름차순).
 * - { year }: 해당 연도 1~12월.
 * 기준월은 Asia/Ho_Chi_Minh(monthKeyVn) — @db.Date는 UTC 자정이므로 월 경계는 UTC로 처리.
 */
export function resolveRangePeriod(range: StatsRange, now: Date): RangePeriod {
  if (typeof range === "object") {
    const { year } = range;
    if (!Number.isInteger(year) || year < 2000 || year > 2999) {
      throw new RangeError(`잘못된 연도: ${year}`);
    }
    const monthKeys = Array.from(
      { length: 12 },
      (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`
    );
    return {
      monthKeys,
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }

  const count = range === "6" ? 6 : 12;
  // 기준 = VN 기준 현재 달. @db.Date 월 경계는 UTC 자정으로 다룬다(계약 §4.1).
  const currentKey = monthKeyVn(now); // "YYYY-MM"
  const currentStart = monthKeyToUtcStart(currentKey);
  const monthKeys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - i, 1)
    );
    monthKeys.push(utcMonthKey(d));
  }
  return {
    monthKeys,
    start: monthKeyToUtcStart(monthKeys[0]),
    // 마지막 달의 익월 1일
    end: new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() + 1, 1)),
  };
}

/** range 문자열(URL 쿼리) → StatsRange. "6"·"12"·"YYYY"(연도). 무효는 기본 "12". */
export function parseStatsRange(raw: string | undefined): StatsRange {
  if (raw === "6") return "6";
  if (raw === "12") return "12";
  if (raw && /^\d{4}$/.test(raw)) {
    const year = Number(raw);
    if (year >= 2000 && year <= 2999) return { year };
  }
  return "12";
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

// ── 1. 개요(매출·마진) — canViewFinance 전용 ────────────────────────

/** 월별 매출 추이 1행 (통화 분리). 합산 금지 — KRW·VND 나란히. */
export interface MonthlyRevenuePoint {
  monthKey: string;
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

/** KPI(이번달/전월) + 전월 대비. 통화 분리. */
export interface RevenueKpi {
  monthKey: string;
  krwRevenue: number;
  krwRevenueText: string;
  vndRevenue: number;
  vndRevenueText: string;
  marginVnd: number;
  marginVndText: string;
  marginRatePct: number | null;
  fxMissingCount: number;
  /** 전월 대비 증감률(%) — 이전값 0이면 null */
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
  range: { monthKeys: string[] };
  monthly: MonthlyRevenuePoint[];
  current: RevenueKpi;
  previous: RevenueKpi;
  channels: ChannelStat[];
}

interface RevenueSourceRow extends FinanceSourceRow {
  checkOut: Date;
  channel: BookingChannel;
}

/**
 * loadOverviewStats — 재무 전용(canViewFinance 게이트는 호출부(page.tsx)에서 확인 후 호출).
 * 최근 N개월 월별 매출추이 + 이번달/전월 KPI + 채널별 건수·매출.
 * 매출 인식 = 체크아웃 월, SETTLEMENT_BOOKING_STATUSES. 통화 분리·마진 환산은 summarizeFinance.
 */
export async function loadOverviewStats(
  range: StatsRange,
  now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<OverviewStats> {
  const period = resolveRangePeriod(range, now);
  // 추이 + 전월 KPI를 위해 한 달 더 과거까지 조회 (전월 대비 산출용)
  const prevStart = new Date(
    Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth() - 1, 1)
  );
  const prevKey = utcMonthKey(prevStart);

  const rows: RevenueSourceRow[] = await db.booking.findMany({
    where: {
      status: { in: SETTLEMENT_STATUS_FILTER },
      checkOut: { gte: prevStart, lt: period.end },
    },
    select: {
      checkOut: true,
      channel: true,
      saleCurrency: true,
      totalSaleKrw: true,
      totalSaleVnd: true,
      supplierCostVnd: true,
      fxVndPerKrw: true,
    },
  });

  // 체크아웃이 속한 월키(UTC 경계 — @db.Date)로 버킷팅
  const byMonth = new Map<string, RevenueSourceRow[]>();
  for (const r of rows) {
    const key = utcMonthKey(r.checkOut);
    const list = byMonth.get(key) ?? [];
    list.push(r);
    byMonth.set(key, list);
  }

  const summarizeMonth = (key: string): FinanceSummary =>
    summarizeFinance((byMonth.get(key) ?? []).map(toFinanceBooking));

  const monthly: MonthlyRevenuePoint[] = period.monthKeys.map((key) => {
    const s = summarizeMonth(key);
    const block = toFinanceBlock(s);
    return {
      monthKey: key,
      krwRevenue: block.krwRevenue,
      krwRevenueText: block.krwRevenueText,
      vndRevenue: block.vndRevenue,
      vndRevenueText: block.vndRevenueText,
      marginVnd: block.marginVnd,
      marginVndText: block.marginVndText,
      fxMissingCount: block.fxMissingCount,
    };
  });

  const buildKpi = (key: string, prevSummary: FinanceSummary): RevenueKpi => {
    const s = summarizeMonth(key);
    const block = toFinanceBlock(s);
    const prevBlock = toFinanceBlock(prevSummary);
    return {
      monthKey: key,
      krwRevenue: block.krwRevenue,
      krwRevenueText: block.krwRevenueText,
      vndRevenue: block.vndRevenue,
      vndRevenueText: block.vndRevenueText,
      marginVnd: block.marginVnd,
      marginVndText: block.marginVndText,
      marginRatePct: block.marginRatePct,
      fxMissingCount: block.fxMissingCount,
      krwChangePct: changeRate(block.krwRevenue, prevBlock.krwRevenue),
      vndChangePct: changeRate(block.vndRevenue, prevBlock.vndRevenue),
      marginChangePct: changeRate(block.marginVnd, prevBlock.marginVnd),
    };
  };

  const currentKey = period.monthKeys[period.monthKeys.length - 1];
  const previousKey = period.monthKeys[period.monthKeys.length - 2] ?? prevKey;
  const beforePreviousKey = utcMonthKey(
    new Date(Date.UTC(monthKeyToUtcStart(previousKey).getUTCFullYear(), monthKeyToUtcStart(previousKey).getUTCMonth() - 1, 1))
  );

  const current = buildKpi(currentKey, summarizeMonth(previousKey));
  const previous = buildKpi(previousKey, summarizeMonth(beforePreviousKey));

  // 채널별 — 기간(period.start~end) 내 매출만(전월 보조 데이터 제외)
  const inPeriod = (r: RevenueSourceRow) =>
    r.checkOut.getTime() >= period.start.getTime() &&
    r.checkOut.getTime() < period.end.getTime();
  const byChannel = new Map<BookingChannel, RevenueSourceRow[]>();
  for (const r of rows) {
    if (!inPeriod(r)) continue;
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
    range: { monthKeys: period.monthKeys },
    monthly,
    current,
    previous,
    channels,
  };
}

// ── 2. 가동률(점유율) — 전 운영자 ───────────────────────────────────

export interface MonthlyOccupancyPoint {
  monthKey: string;
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
  /** 최근 12개월 추이(라인) */
  monthly: MonthlyOccupancyPoint[];
  /** 이번 달 전체 가동률(%) */
  currentRatePct: number;
  /** 전월 대비 증감(%포인트, 소수 1자리). 전월 0%면 null */
  changePct: number | null;
  /** 이번 달 평균 박수(점유박/예약수). 예약 0건이면 0 */
  avgNights: number;
  /** 이번 달 점유 예약수 */
  bookingCount: number;
  /** 빌라별 가동률 내림차순(이번 달) */
  villas: VillaOccupancy[];
}

interface OccupancyBookingRow extends OccupancyBookingRange {
  villaId: string;
}

/** half-open [checkIn, checkOut) 의 [monthStart, monthEnd) 클리핑 점유박 (computeOccupancyRate와 동일 규약) */
function clippedNights(b: OccupancyBookingRange, monthStart: Date, monthEnd: Date): number {
  const start = Math.max(b.checkIn.getTime(), monthStart.getTime());
  const end = Math.min(b.checkOut.getTime(), monthEnd.getTime());
  if (end <= start) return 0;
  return Math.round((end - start) / MS_PER_DAY);
}

/**
 * loadOccupancyStats — 전 운영자. 월별 가동률 추이(최근 12개월, computeOccupancyRate 재사용)
 * + 이번달 전체 가동률·전월대비·평균박수 + 빌라별 가동률 내림차순. 점유상태=OCCUPANCY_STAY_STATUSES.
 * 분모 빌라수 = 현재 ACTIVE 근사(헬퍼 주석과 동일 — 월 중 승인 시점 무시).
 */
export async function loadOccupancyStats(
  range: StatsRange,
  now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<OccupancyStats> {
  const period = resolveRangePeriod(range, now);
  // 추이는 항상 최근 12개월(계약 §5.탭2) — range가 6이어도 추이는 12개월 일관 표시.
  // 단, range가 연도면 그 12개월을 사용. range가 "6"/"12"면 12개월 윈도우로 보정.
  const trailing12 =
    typeof range === "object" ? period : resolveRangePeriod("12", now);

  // 점유 후보 예약 일괄 조회 — 추이 윈도우 ∪ 이번 달을 모두 덮는 [start, end)
  const windowStart = trailing12.start;
  const windowEnd = trailing12.end;

  const [bookings, activeVillaCount, villas] = await Promise.all([
    db.booking.findMany({
      where: {
        status: { in: OCCUPANCY_STATUS_FILTER },
        // 윈도우와 겹치는 예약만 (checkOut > windowStart AND checkIn < windowEnd)
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

  // 월별 추이 — 각 월마다 computeOccupancyRate(전체 ACTIVE 분모) 재사용
  const monthly: MonthlyOccupancyPoint[] = trailing12.monthKeys.map((key) => {
    const { start, end } = monthRangeUtc(key);
    const ratePct = computeOccupancyRate(rows, activeVillaCount, start, end);
    return { monthKey: key, ratePct };
  });

  // 이번 달(VN 기준 현재 달) 상세
  const currentKey = monthKeyVn(now);
  const { start: curStart, end: curEnd } = monthRangeUtc(currentKey);
  const currentRatePct = computeOccupancyRate(rows, activeVillaCount, curStart, curEnd);
  const prevStart = new Date(Date.UTC(curStart.getUTCFullYear(), curStart.getUTCMonth() - 1, 1));
  const prevEnd = curStart;
  const prevRatePct = computeOccupancyRate(rows, activeVillaCount, prevStart, prevEnd);
  const changePct =
    prevRatePct === 0 ? null : Math.round((currentRatePct - prevRatePct) * 10) / 10;

  // 이번 달 빌라별 점유박 + 예약수
  const monthDays = Math.round((curEnd.getTime() - curStart.getTime()) / MS_PER_DAY);
  const nightsByVilla = new Map<string, number>();
  let currentBookingCount = 0;
  for (const b of rows) {
    const n = clippedNights(b, curStart, curEnd);
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
      monthDays > 0
        ? Math.round(Math.min((occupiedNights / monthDays) * 100, 100) * 10) / 10
        : 0;
    return { villaId: v.id, name: v.name, complex: v.complex, occupiedNights, ratePct };
  });
  villaStats.sort((a, b) => b.ratePct - a.ratePct || b.occupiedNights - a.occupiedNights);

  return {
    monthly,
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
  range: StatsRange,
  includeFinance: boolean,
  now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<VillaPerformanceRow[]> {
  const period = resolveRangePeriod(range, now);
  const periodDays = Math.round((period.end.getTime() - period.start.getTime()) / MS_PER_DAY);

  // 점유: 기간 내 점유상태 예약 (가동률·예약수·박수)
  const occBookings = await db.booking.findMany({
    where: {
      status: { in: OCCUPANCY_STATUS_FILTER },
      checkIn: { lt: period.end },
      checkOut: { gt: period.start },
    },
    select: { villaId: true, status: true, checkIn: true, checkOut: true },
  });

  // 매출: 정산 기준(체크아웃 월·SETTLEMENT_BOOKING_STATUSES) — includeFinance일 때만
  const finBookings = includeFinance
    ? await db.booking.findMany({
        where: {
          status: { in: SETTLEMENT_STATUS_FILTER },
          checkOut: { gte: period.start, lt: period.end },
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
    const n = clippedNights(b, period.start, period.end);
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
  range: StatsRange,
  now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<FunnelStats> {
  const period = resolveRangePeriod(range, now);

  // 기간 내 생성된 제안 + 항목의 연결 예약 상태
  const proposals = await db.proposal.findMany({
    where: { createdAt: { gte: period.start, lt: period.end } },
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
  range: StatsRange,
  includeFinance: boolean,
  now: Date = new Date(),
  db: PrismaClient = prisma
): Promise<OperationsStats> {
  const period = resolveRangePeriod(range, now);

  // 기간 내 생성 예약 — 홀드·취소·노쇼 비율 모집단
  const bookings = await db.booking.findMany({
    where: { createdAt: { gte: period.start, lt: period.end } },
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
      where: { approvedAt: { gte: period.start, lt: period.end } },
      select: { createdAt: true, approvedAt: true },
    }),
    db.cleaningTask.count({ where: { status: "PHOTOS_SUBMITTED" } }),
    db.cleaningTask.count({
      where: { status: "REJECTED", createdAt: { gte: period.start, lt: period.end } },
    }),
    db.cleaningTask.count({
      where: { status: "PHOTOS_SUBMITTED", createdAt: { gte: period.start, lt: period.end } },
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
