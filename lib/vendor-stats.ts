// 원천 공급자(VENDOR) 발주 통계 로더 (ADR-0023 S4, SPEC §6.4)
//
// ★ 누수 절대 규칙: 공급자 "매출"은 costVnd(=우리가 그에게 지급할 금액)뿐이다.
//   우리 판매가(priceKrw/priceVnd)·마진·타 공급자 발주·전체 재고는 이 모듈이 조회조차 하지 않는다
//   (select 화이트리스트). 모든 쿼리는 vendorId = 인자 vendorId 로 스코프를 강제한다(세션 외 입력 금지).
//
// 집계 의미:
//   - 매출 = 확정·이행된 발주(vendorStatus=VENDOR_ACCEPTED 그리고 status IN CONFIRMED·DELIVERED).
//     거절(VENDOR_REJECTED)·취소(CANCELLED)·대기(PENDING_VENDOR)는 매출에서 제외.
//   - 발주액 = costVnd × quantity (정산액 규약 — schema: 정산액=costVnd×quantity).
//   - 수락율 = 수락 / (수락 + 거절) (응답한 발주 중 수락 비율).
//   - 정산 = vendorSettledAt 기준 미정산 vs 정산완료 금액.
//   통화 VND 단일(합산 OK, 원장 아님). BigInt 문자열/안전정수 직렬화.
//
// supplier-stats.ts 구조 미러(순수 함수 층 + DB 스코프 단일 로더).
import { ServiceOrderStatus, ServiceVendorStatus, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { StatsPeriod } from "@/lib/statistics";
import { pickI18n, selectedOptionLabels } from "@/lib/service-display";

// 매출 인식 = 수락 + 확정/이행. 거절·취소·대기 제외.
const REVENUE_VENDOR_STATUS = ServiceVendorStatus.VENDOR_ACCEPTED;
const REVENUE_ORDER_STATUSES = [
  ServiceOrderStatus.CONFIRMED,
  ServiceOrderStatus.DELIVERED,
] as const;

// ===================================================================
// 순수 함수 층 (DB 무관 — 단위 테스트 대상)
// ===================================================================

/**
 * 공급자 VND 점 구분 표기 (15.000.000₫). DESIGN.md — ADMIN 쉼표와 다름.
 * BigInt 문자열 정규식 — Number() 금지(정밀도 손실 방지).
 */
export function formatVndDot(value: bigint): string {
  const raw = value.toString();
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}₫`;
}

/** 전기간 대비 증감(%). 이전값 0·null이면 null(÷0 방지). 소수 1자리. */
export function changeRateOrNull(current: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** 수락율(%) = 수락 / (수락 + 거절). 응답 0건이면 null(÷0 방지). 소수 1자리. */
export function acceptanceRateOrNull(accepted: number, rejected: number): number | null {
  const responded = accepted + rejected;
  if (responded === 0) return null;
  return Math.round((accepted / responded) * 1000) / 10;
}

/** 발주 한 건의 정산액 = costVnd × quantity (BigInt, 음수 quantity 방어). */
export function orderAmountVnd(costVnd: bigint, quantity: number): bigint {
  const q = quantity > 0 ? quantity : 0;
  return costVnd * BigInt(q);
}

// ===================================================================
// 매출 귀속 시점 — serviceDate 우선, 없으면 booking.checkOut. 둘 다 없으면 createdAt.
// (발주는 일정 기준으로 보여줘야 공급자가 이해 — board scheduleLabel과 동일 우선순위.)
// ===================================================================

interface OrderRow {
  vendorStatus: ServiceVendorStatus | null;
  status: ServiceOrderStatus;
  costVnd: bigint;
  quantity: number;
  serviceDate: Date | null;
  checkOut: Date | null;
  createdAt: Date;
  vendorSettledAt: Date | null;
  /** 품목명 스냅샷 — 카탈로그 nameKo 또는 vendorName 또는 type */
  itemLabel: string;
}

/** 발주 귀속 일자(UTC 자정/타임스탬프) — serviceDate > checkOut > createdAt */
export function attributionDate(o: {
  serviceDate: Date | null;
  checkOut: Date | null;
  createdAt: Date;
}): Date {
  return o.serviceDate ?? o.checkOut ?? o.createdAt;
}

/** 매출 인식 대상인가 — 수락 + 확정/이행 */
export function isRevenueOrder(o: {
  vendorStatus: ServiceVendorStatus | null;
  status: ServiceOrderStatus;
}): boolean {
  return (
    o.vendorStatus === REVENUE_VENDOR_STATUS &&
    (REVENUE_ORDER_STATUSES as readonly ServiceOrderStatus[]).includes(o.status)
  );
}

/** 귀속일이 속하는 버킷 index. 버킷은 [start,end) 연속 타일. 없으면 -1. */
function bucketIndexOf(buckets: StatsPeriod["buckets"], at: Date): number {
  const t = at.getTime();
  for (let i = 0; i < buckets.length; i++) {
    if (t >= buckets[i].start.getTime() && t < buckets[i].end.getTime()) return i;
  }
  return -1;
}

// ===================================================================
// 직렬화 타입 (client로 안전 전달 — Date 없음, 금지 필드 없음)
// ===================================================================

export interface VendorRevenuePoint {
  bucketKey: string;
  label: string;
  /** 차트 축용 number (costVnd×quantity 합, VND는 안전정수 범위) */
  vnd: number;
  /** 정확표시용 점 구분 문자열 (45.000.000₫) */
  vndText: string;
}

export interface VendorItemStat {
  /** 품목명 스냅샷(nameKo/vendorName/type) — 데이터, 번역 불필요 */
  itemLabel: string;
  /** 이행 발주 건수 */
  orderCount: number;
  /** 소비 수량 합 */
  quantity: number;
  vnd: number;
  vndText: string;
}

export interface VendorStats {
  /** 버킷별 매출 추이(막대) */
  revenueTrend: VendorRevenuePoint[];
  /** 기간 총 매출(VND) */
  totalVnd: number;
  totalVndText: string;
  /** 직전 동기간 대비 매출 증감(%), 없으면 null */
  revenueChangePct: number | null;
  /** 기간 이행 발주 수(매출 인식 대상) */
  orderCount: number;
  /** 수락율(%) — 수락/(수락+거절), 응답 0이면 null */
  acceptanceRatePct: number | null;
  /** 평균 단가(매출/이행 발주수, VND). 0건이면 0 */
  avgUnitVnd: number;
  avgUnitVndText: string;
  /** 인기 품목 Top(매출 내림차순) */
  topItems: VendorItemStat[];
  /** 미정산 금액(VND) — 매출 인식 발주 중 vendorSettledAt 없음 */
  unsettledVnd: number;
  unsettledVndText: string;
  /** 정산완료 금액(VND) — 매출 인식 발주 중 vendorSettledAt 있음 */
  settledVnd: number;
  settledVndText: string;
}

const REVENUE_SELECT = {
  vendorStatus: true,
  status: true,
  costVnd: true,
  quantity: true,
  serviceDate: true,
  vendorSettledAt: true,
  createdAt: true,
  type: true,
  vendorName: true,
  catalogItemId: true,
  // 선택 코스(variant) 구분용 — 가격은 selectedOptionLabels가 제거(공급자 누수 방지).
  selectedOptions: true,
  booking: { select: { checkOut: true } },
} as const;

// ===================================================================
// 순수 집계 — DB에서 평탄화한 OrderRow[] → VendorStats (테스트 대상)
// ===================================================================

/**
 * aggregateVendorStats — 평탄화된 발주 행 배열을 받아 기간 KPI·추이·품목·정산을 집계한다.
 * DB 무관 순수 함수(테스트 가능). 행은 이미 vendorId 스코프로 걸러진 것만 들어와야 한다(호출부 보장).
 *
 * - 매출/추이/품목/정산: isRevenueOrder(수락+확정/이행)만 산입.
 * - 수락율: 전체 응답(수락+거절) 기준(매출 인식과 별개로 응답 행 전체 집계).
 * - 추이/총계는 기간 [from,to)·직전 동기간 [previous.from,previous.to)로 귀속일 분기.
 */
export function aggregateVendorStats(rows: OrderRow[], period: StatsPeriod): VendorStats {
  const bucketSums: bigint[] = period.buckets.map(() => 0n);
  let totalVnd = 0n;
  let prevTotalVnd = 0n;
  let orderCount = 0;
  let accepted = 0;
  let rejected = 0;
  let unsettledVnd = 0n;
  let settledVnd = 0n;

  const itemMap = new Map<string, { orderCount: number; quantity: number; vnd: bigint }>();

  for (const o of rows) {
    // 수락율 모집단 — 응답한 발주(수락/거절)는 매출 인식 여부와 무관하게 카운트
    if (o.vendorStatus === ServiceVendorStatus.VENDOR_ACCEPTED) accepted += 1;
    else if (o.vendorStatus === ServiceVendorStatus.VENDOR_REJECTED) rejected += 1;

    if (!isRevenueOrder(o)) continue;

    const amount = orderAmountVnd(o.costVnd, o.quantity);
    const at = attributionDate(o);
    const inCurrent =
      at.getTime() >= period.from.getTime() && at.getTime() < period.to.getTime();

    if (inCurrent) {
      totalVnd += amount;
      orderCount += 1;
      const idx = bucketIndexOf(period.buckets, at);
      if (idx >= 0) bucketSums[idx] += amount;

      // 품목별 집계
      const cur = itemMap.get(o.itemLabel) ?? { orderCount: 0, quantity: 0, vnd: 0n };
      cur.orderCount += 1;
      cur.quantity += o.quantity > 0 ? o.quantity : 0;
      cur.vnd += amount;
      itemMap.set(o.itemLabel, cur);

      // 정산 상태별
      if (o.vendorSettledAt) settledVnd += amount;
      else unsettledVnd += amount;
    } else if (
      period.previous &&
      at.getTime() >= period.previous.from.getTime() &&
      at.getTime() < period.previous.to.getTime()
    ) {
      prevTotalVnd += amount;
    }
  }

  const revenueTrend: VendorRevenuePoint[] = period.buckets.map((bucket, i) => ({
    bucketKey: bucket.key,
    label: bucket.label,
    vnd: Number(bucketSums[i]),
    vndText: formatVndDot(bucketSums[i]),
  }));

  const topItems: VendorItemStat[] = [...itemMap.entries()]
    .map(([itemLabel, v]) => ({
      itemLabel,
      orderCount: v.orderCount,
      quantity: v.quantity,
      vnd: Number(v.vnd),
      vndText: formatVndDot(v.vnd),
    }))
    .sort((a, b) => b.vnd - a.vnd || b.orderCount - a.orderCount)
    .slice(0, 8);

  const avgUnit = orderCount > 0 ? totalVnd / BigInt(orderCount) : 0n;

  return {
    revenueTrend,
    totalVnd: Number(totalVnd),
    totalVndText: formatVndDot(totalVnd),
    revenueChangePct: changeRateOrNull(
      Number(totalVnd),
      period.previous ? Number(prevTotalVnd) : null
    ),
    orderCount,
    acceptanceRatePct: acceptanceRateOrNull(accepted, rejected),
    avgUnitVnd: Number(avgUnit),
    avgUnitVndText: formatVndDot(avgUnit),
    topItems,
    unsettledVnd: Number(unsettledVnd),
    unsettledVndText: formatVndDot(unsettledVnd),
    settledVnd: Number(settledVnd),
    settledVndText: formatVndDot(settledVnd),
  };
}

// ===================================================================
// DB 층 — 공급자(vendor) 스코프 단일 로더
// ===================================================================

/**
 * loadVendorStats — vendorId 스코프. 매출 추이(막대)·기간 KPI·인기 품목·정산 상태.
 * 모든 발주 쿼리 vendorId 강제. 금액은 costVnd만(우리 판매가 priceKrw/priceVnd·마진 비조회).
 * 수락율 모집단·매출 집계를 한 번에 위해 윈도우 = [previous.from(있으면), to) + 응답 전체.
 */
export async function loadVendorStats(
  vendorId: string,
  period: StatsPeriod,
  locale: string = "vi",
  db: PrismaClient = prisma
): Promise<VendorStats> {
  const windowStart = period.previous ? period.previous.from : period.from;
  const windowEnd = period.to;

  // 수락율은 "기간 내 응답한 발주" 기준 — vendorRespondedAt 컬럼은 있으나 단순화 위해
  // 매출 윈도우와 동일 범위(귀속일 기준)에서 응답행을 함께 본다. vendorId 스코프 강제.
  const orders = await db.serviceOrder.findMany({
    where: {
      vendorId,
      // 발주는 booking 필수(bookingId 비널) — serviceDate 우선, 없으면 booking.checkOut으로 귀속.
      OR: [
        // 매출/추이 대상 + 직전 동기간: 귀속일(serviceDate)이 윈도우 내
        { serviceDate: { gte: windowStart, lt: windowEnd } },
        // serviceDate 없는 발주는 booking.checkOut으로 귀속
        { serviceDate: null, booking: { checkOut: { gte: windowStart, lt: windowEnd } } },
      ],
    },
    select: REVENUE_SELECT,
  });

  // 품목명 스냅샷 — catalogItemId는 관계 미정의 스칼라이므로 일괄 조회 후 매핑(orders route 패턴).
  const itemIds = Array.from(
    new Set(orders.map((o) => o.catalogItemId).filter((v): v is string => !!v))
  );
  const items = itemIds.length
    ? await db.serviceCatalogItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, nameKo: true, nameI18n: true },
      })
    : [];
  const itemNameById = new Map(
    items.map((i) => [i.id, pickI18n(i.nameKo, i.nameI18n, locale)])
  );

  const flat: OrderRow[] = orders.map((o) => {
    const baseName =
      (o.catalogItemId ? itemNameById.get(o.catalogItemId) : null) ?? o.vendorName ?? o.type;
    // 인기 품목은 코스(variant)까지 구분 — "마사지 · 오일 마사지 90분". 가격은 제거됨.
    const course = selectedOptionLabels(o.selectedOptions, locale).join(" · ");
    return {
      vendorStatus: o.vendorStatus,
      status: o.status,
      costVnd: o.costVnd,
      quantity: o.quantity,
      serviceDate: o.serviceDate,
      checkOut: o.booking?.checkOut ?? null,
      createdAt: o.createdAt,
      vendorSettledAt: o.vendorSettledAt,
      itemLabel: course ? `${baseName} · ${course}` : baseName,
    };
  });

  return aggregateVendorStats(flat, period);
}
