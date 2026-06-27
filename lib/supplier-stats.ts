// 공급자(SUPPLIER) 매출·가동율 통계 로더 (T-supplier-statistics, SPEC F6)
//
// 마진 비공개 절대 원칙: 공급자 "매출"은 supplierCostVnd(우리가 공급자에게 지급하는 원가)뿐이다.
// 판매가(KRW/VND)·마진·환율·고객 정보는 이 모듈이 조회조차 하지 않는다(select 화이트리스트).
// 모든 쿼리는 villa.supplierId = 인자 supplierId 로 스코프를 강제한다(세션 외 입력 금지).
//
// 집계 의미는 기존 단일 소스를 재사용한다:
// - 매출 = SETTLEMENT_BOOKING_STATUSES(CHECKED_OUT·NO_SHOW), 체크아웃이 속한 버킷 기준(lib/settlement 규약)
// - 가동율 = computeOccupancyRate(OCCUPANCY_STAY_STATUSES, half-open 점유박/(ACTIVE 빌라수×일수))
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatVillaName } from "@/lib/villa-name";
import {
  computeOccupancyRate,
  OCCUPANCY_STAY_STATUSES,
  type OccupancyBookingRange,
} from "@/lib/booking-stats";
import { SETTLEMENT_BOOKING_STATUSES } from "@/lib/settlement";
import type { StatsPeriod } from "@/lib/statistics";
import { formatVndDot } from "@/lib/format";

const MS_PER_DAY = 86_400_000;
const OCCUPANCY_STATUS_FILTER = [...OCCUPANCY_STAY_STATUSES];
const SETTLEMENT_STATUS_FILTER = [...SETTLEMENT_BOOKING_STATUSES];

// ===================================================================
// 순수 함수 층 (DB 무관 — 단위 테스트 대상)
// ===================================================================

// VND 점 구분 표기(15.000.000₫)는 lib/format.ts 단일 소스 — 재export로 기존 import 호환.
export { formatVndDot };

/** half-open [checkIn, checkOut) 의 [winStart, winEnd) 클리핑 점유박 (computeOccupancyRate와 동일 규약) */
export function clippedNights(b: OccupancyBookingRange, winStart: Date, winEnd: Date): number {
  const start = Math.max(b.checkIn.getTime(), winStart.getTime());
  const end = Math.min(b.checkOut.getTime(), winEnd.getTime());
  if (end <= start) return 0;
  return Math.round((end - start) / MS_PER_DAY);
}

/** 전기간 대비 증감(%). 이전값 0·null이면 null(÷0 방지). 소수 1자리. */
export function changeRateOrNull(current: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** 가동율 증감(%포인트). 이전 0·null이면 null. 소수 1자리. */
function occupancyChange(current: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round((current - previous) * 10) / 10;
}

// ===================================================================
// 직렬화 타입 (client로 안전 전달 — Date 없음, 금지 필드 없음)
// ===================================================================

export interface SupplierRevenuePoint {
  bucketKey: string;
  label: string;
  /** 차트 축용 number (supplierCostVnd 합, VND는 안전정수 범위) */
  vnd: number;
  /** 정확표시용 점 구분 문자열 (45.000.000₫) */
  vndText: string;
}

export interface SupplierOccupancyPoint {
  bucketKey: string;
  label: string;
  /** 가동율(%) 0~100, 소수 1자리 */
  ratePct: number;
}

export interface SupplierVillaPerf {
  villaId: string;
  name: string;
  complex: string | null;
  bookingCount: number;
  occupiedNights: number;
  ratePct: number;
  vnd: number;
  vndText: string;
}

export interface SupplierStats {
  /** 버킷별 수익 추이(막대) */
  revenueTrend: SupplierRevenuePoint[];
  /** 버킷별 가동율 추이(라인) */
  occupancyTrend: SupplierOccupancyPoint[];
  /** 기간 총 수익(VND) */
  totalVnd: number;
  totalVndText: string;
  /** 직전 동기간 대비 수익 증감(%), 없으면 null */
  revenueChangePct: number | null;
  /** 기간 전체 가동율(%) */
  currentRatePct: number;
  /** 직전 동기간 대비 가동율 증감(%p), 없으면 null */
  occupancyChangePct: number | null;
  /** 기간 점유 예약수 */
  bookingCount: number;
  /** 평균 박수(점유박/예약수). 예약 0건이면 0 */
  avgNights: number;
  /** 내 ACTIVE 빌라 수(분모) */
  villaCount: number;
  /** 빌라별 성과(수익 내림차순) */
  villas: SupplierVillaPerf[];
}

interface RevenueRow {
  checkOut: Date;
  supplierCostVnd: bigint;
}

interface OccupancyRow extends OccupancyBookingRange {
  villaId: string;
}

/** checkOut(UTC 자정)이 속하는 버킷 index 탐색. 버킷은 [from,to) 연속 타일. 없으면 -1. */
function bucketIndexOf(buckets: StatsPeriod["buckets"], checkOut: Date): number {
  const t = checkOut.getTime();
  for (let i = 0; i < buckets.length; i++) {
    if (t >= buckets[i].start.getTime() && t < buckets[i].end.getTime()) return i;
  }
  return -1;
}

// ===================================================================
// DB 층 — 공급자 스코프 단일 로더
// ===================================================================

/**
 * loadSupplierStats — supplierId 스코프. 수익 추이(막대)·가동율 추이(라인)·기간 KPI·빌라별 성과.
 * 모든 빌라 쿼리 supplierId 강제. 금액은 supplierCostVnd만(판매가·마진·환율·고객 비조회).
 * 가동율 분모 = 해당 공급자 현재 ACTIVE 빌라수(헬퍼 주석과 동일 근사 — 기간 중 승인 시점 무시).
 */
export async function loadSupplierStats(
  supplierId: string,
  period: StatsPeriod,
  db: PrismaClient = prisma
): Promise<SupplierStats> {
  // 추이·총계·직전 동기간을 모두 덮는 윈도우
  const windowStart = period.previous ? period.previous.from : period.from;
  const windowEnd = period.to;

  const [revenueBookings, occupancyBookings, activeVillaCount, villas] = await Promise.all([
    // 수익: 체크아웃이 윈도우에 속하는 정산대상 예약(원가만 select)
    db.booking.findMany({
      where: {
        status: { in: SETTLEMENT_STATUS_FILTER },
        checkOut: { gte: windowStart, lt: windowEnd },
        villa: { supplierId },
      },
      select: { checkOut: true, supplierCostVnd: true, villaId: true },
    }),
    // 가동율: 윈도우와 겹치는 점유 예약(금액 비조회)
    db.booking.findMany({
      where: {
        status: { in: OCCUPANCY_STATUS_FILTER },
        checkIn: { lt: windowEnd },
        checkOut: { gt: windowStart },
        villa: { supplierId },
      },
      select: { status: true, checkIn: true, checkOut: true, villaId: true },
    }),
    db.villa.count({ where: { status: "ACTIVE", supplierId } }),
    db.villa.findMany({
      where: { status: "ACTIVE", supplierId },
      select: { id: true, name: true, nameVi: true, complex: true },
    }),
  ]);

  // ── 수익 추이(버킷별 supplierCostVnd 합) ──
  const bucketSums: bigint[] = period.buckets.map(() => 0n);
  const revenueByVilla = new Map<string, bigint>();
  let totalVnd = 0n;
  let prevTotalVnd = 0n;
  for (const b of revenueBookings as (RevenueRow & { villaId: string })[]) {
    const inCurrent =
      b.checkOut.getTime() >= period.from.getTime() && b.checkOut.getTime() < period.to.getTime();
    if (inCurrent) {
      totalVnd += b.supplierCostVnd;
      revenueByVilla.set(b.villaId, (revenueByVilla.get(b.villaId) ?? 0n) + b.supplierCostVnd);
      const idx = bucketIndexOf(period.buckets, b.checkOut);
      if (idx >= 0) bucketSums[idx] += b.supplierCostVnd;
    } else if (
      period.previous &&
      b.checkOut.getTime() >= period.previous.from.getTime() &&
      b.checkOut.getTime() < period.previous.to.getTime()
    ) {
      prevTotalVnd += b.supplierCostVnd;
    }
  }

  const revenueTrend: SupplierRevenuePoint[] = period.buckets.map((bucket, i) => ({
    bucketKey: bucket.key,
    label: bucket.label,
    vnd: Number(bucketSums[i]),
    vndText: formatVndDot(bucketSums[i]),
  }));

  // ── 가동율 추이 + 기간 가동율 + 직전 동기간 ──
  const occRows: OccupancyRow[] = occupancyBookings;
  const occupancyTrend: SupplierOccupancyPoint[] = period.buckets.map((bucket) => ({
    bucketKey: bucket.key,
    label: bucket.label,
    ratePct: computeOccupancyRate(occRows, activeVillaCount, bucket.start, bucket.end),
  }));
  const currentRatePct = computeOccupancyRate(occRows, activeVillaCount, period.from, period.to);
  const prevRatePct = period.previous
    ? computeOccupancyRate(occRows, activeVillaCount, period.previous.from, period.previous.to)
    : null;

  // ── 빌라별 성과(기간) + 평균박수 ──
  const periodDays = Math.round((period.to.getTime() - period.from.getTime()) / MS_PER_DAY);
  const nightsByVilla = new Map<string, number>();
  let bookingCount = 0;
  for (const b of occRows) {
    const n = clippedNights(b, period.from, period.to);
    if (n <= 0) continue;
    bookingCount += 1;
    nightsByVilla.set(b.villaId, (nightsByVilla.get(b.villaId) ?? 0) + n);
  }
  const totalOccupiedNights = [...nightsByVilla.values()].reduce((a, b) => a + b, 0);
  const avgNights =
    bookingCount > 0 ? Math.round((totalOccupiedNights / bookingCount) * 10) / 10 : 0;

  const villaStats: SupplierVillaPerf[] = villas.map((v) => {
    const occupiedNights = nightsByVilla.get(v.id) ?? 0;
    const ratePct =
      periodDays > 0
        ? Math.round(Math.min((occupiedNights / periodDays) * 100, 100) * 10) / 10
        : 0;
    const vnd = revenueByVilla.get(v.id) ?? 0n;
    return {
      villaId: v.id,
      // 공급자(비운영자) 화면 — 빌라명 베트남어 병기(C2/ADR-0020). stats-section은 truncate 처리.
      name: formatVillaName({ name: v.name, nameVi: v.nameVi }),
      complex: v.complex,
      bookingCount: 0, // 점유 예약수는 기간 합계로만 노출(빌라별 분해는 화면 불필요)
      occupiedNights,
      ratePct,
      vnd: Number(vnd),
      vndText: formatVndDot(vnd),
    };
  });
  villaStats.sort((a, b) => b.vnd - a.vnd || b.ratePct - a.ratePct);

  return {
    revenueTrend,
    occupancyTrend,
    totalVnd: Number(totalVnd),
    totalVndText: formatVndDot(totalVnd),
    revenueChangePct: changeRateOrNull(Number(totalVnd), period.previous ? Number(prevTotalVnd) : null),
    currentRatePct,
    occupancyChangePct: occupancyChange(currentRatePct, prevRatePct),
    bookingCount,
    avgNights,
    villaCount: activeVillaCount,
    villas: villaStats,
  };
}
