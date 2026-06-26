import {
  CreditTier,
  type Partner,
  type PartnerStatus,
  type PartnerType,
  type PrismaClient,
} from "@prisma/client";
import {
  agingBuckets,
  hasOverdue,
  outstandingForPartner,
  overdueOutstanding,
  type AgingBuckets,
  type ReceivableLike,
} from "@/lib/partner";

/**
 * 파트너(B2B) 서버 집계 — DB 조회 + lib/partner 순수 헬퍼 결합 (PARTNER-2).
 * 미수 잔액·Aging·연체는 PartnerReceivable(운영 테이블)에서 도출. 전부 ADMIN(canViewFinance) 전용.
 * ⚠️ 누수: 이 모듈 산출값(미수·신용한도)을 공급자·게스트·공개 라우트에 직렬화 금지.
 */

/** 집계에 필요한 채권 최소 select */
const RECEIVABLE_SELECT = {
  totalVnd: true,
  depositPaidVnd: true,
  balancePaidVnd: true,
  dueDate: true,
  status: true,
} as const;

export interface PartnerAggregate {
  partner: Partner;
  outstandingVnd: bigint;
  /** 실제 연체액(기한경과 미입금만) — 전체 미수(outstandingVnd)와 구분 */
  overdueOutstandingVnd: bigint;
  aging: AgingBuckets;
  overdue: boolean;
  bookingCount: number;
}

function aggregate(
  partner: Partner,
  receivables: ReceivableLike[],
  bookingCount: number,
  asOf: Date
): PartnerAggregate {
  return {
    partner,
    outstandingVnd: outstandingForPartner(receivables),
    overdueOutstandingVnd: overdueOutstanding(receivables, asOf),
    aging: agingBuckets(receivables, asOf),
    overdue: hasOverdue(receivables, asOf),
    bookingCount,
  };
}

/** 파트너 1명의 한도초과 여부 — 등급 B/C에서 미수가 신용한도 초과 (등급 A는 여신 없음) */
export function isOverLimit(agg: PartnerAggregate): boolean {
  if (agg.partner.creditTier === CreditTier.A) return false;
  return agg.outstandingVnd > agg.partner.creditLimitVnd;
}

export interface ReceivablesOverview {
  /** 미수(잔액>0) 파트너만, 연체 우선·미수액 내림차순 */
  partners: PartnerAggregate[];
  totalOutstandingVnd: bigint;
  /** 전 파트너 Aging 합산 */
  aging: AgingBuckets;
  overduePartnerCount: number;
  overdueOutstandingVnd: bigint;
  overLimitPartnerCount: number;
}

/** 미수/여신 대시보드 요약(순수) — 집계 목록에서 전체 미수·연체·한도초과 도출 */
export function summarizeReceivables(aggs: PartnerAggregate[]): ReceivablesOverview {
  const withDebt = aggs.filter((a) => a.outstandingVnd > 0n);
  const partners = [...withDebt].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.outstandingVnd > b.outstandingVnd) return -1;
    if (a.outstandingVnd < b.outstandingVnd) return 1;
    return 0;
  });

  const aging: AgingBuckets = { "0-7": 0n, "8-15": 0n, "16-30": 0n, "30+": 0n, total: 0n };
  let totalOutstandingVnd = 0n;
  let overduePartnerCount = 0;
  let overdueOutstandingVnd = 0n;
  let overLimitPartnerCount = 0;
  for (const a of withDebt) {
    totalOutstandingVnd += a.outstandingVnd;
    aging["0-7"] += a.aging["0-7"];
    aging["8-15"] += a.aging["8-15"];
    aging["16-30"] += a.aging["16-30"];
    aging["30+"] += a.aging["30+"];
    aging.total += a.aging.total;
    if (a.overdue) {
      overduePartnerCount += 1;
      // 연체 파트너의 *실제 연체액*만 합산(전체 미수 아님) — "연체 미수" KPI 정확화
      overdueOutstandingVnd += a.overdueOutstandingVnd;
    }
    if (isOverLimit(a)) overLimitPartnerCount += 1;
  }
  return {
    partners,
    totalOutstandingVnd,
    aging,
    overduePartnerCount,
    overdueOutstandingVnd,
    overLimitPartnerCount,
  };
}

/** 미수/여신 대시보드 데이터 (DB) */
export async function getReceivablesOverview(
  prisma: PrismaClient,
  asOf: Date
): Promise<ReceivablesOverview> {
  const aggs = await getPartnersWithAggregates(prisma, asOf);
  return summarizeReceivables(aggs);
}

/** 경량 파트너 옵션 — 드롭다운(파트너 지정)용. 미수·Aging·채권 미조회(과조회·재무 데이터 차단). */
export interface PartnerOption {
  id: string;
  name: string;
  nameVi: string | null;
  type: PartnerType;
  creditTier: CreditTier;
  status: PartnerStatus;
}

/** 경량 파트너 목록 — id·표시명·유형만. type 지정 시 해당 유형만. 이름 오름차순. */
export async function getPartnerOptions(
  prisma: PrismaClient,
  type?: PartnerType
): Promise<PartnerOption[]> {
  return prisma.partner.findMany({
    where: type ? { type } : undefined,
    select: { id: true, name: true, nameVi: true, type: true, creditTier: true, status: true },
    orderBy: { name: "asc" },
  });
}

/** 파트너 목록 + 미수/Aging 집계 (목록 화면) */
export async function getPartnersWithAggregates(
  prisma: PrismaClient,
  asOf: Date
): Promise<PartnerAggregate[]> {
  const rows = await prisma.partner.findMany({
    include: {
      receivables: { select: RECEIVABLE_SELECT },
      _count: { select: { bookings: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(({ receivables, _count, ...partner }) =>
    aggregate(partner as Partner, receivables, _count.bookings, asOf)
  );
}

export interface PartnerBookingRow {
  id: string;
  villaName: string;
  checkIn: Date;
  checkOut: Date;
  status: string;
  totalSaleVnd: bigint | null;
}

export interface PartnerDetail extends PartnerAggregate {
  receivables: Array<{
    id: string;
    bookingId: string;
    totalVnd: bigint;
    depositDueVnd: bigint;
    depositPaidVnd: bigint;
    balancePaidVnd: bigint;
    dueDate: Date;
    status: string;
  }>;
  bookings: PartnerBookingRow[];
}

/** 파트너 상세 — 신용정보 + 미수 현황 + 채권·예약 이력 (상세 화면). 없으면 null */
export async function getPartnerDetail(
  prisma: PrismaClient,
  partnerId: string,
  asOf: Date
): Promise<PartnerDetail | null> {
  const row = await prisma.partner.findUnique({
    where: { id: partnerId },
    include: {
      receivables: {
        select: {
          id: true,
          bookingId: true,
          totalVnd: true,
          depositDueVnd: true,
          depositPaidVnd: true,
          balancePaidVnd: true,
          dueDate: true,
          status: true,
        },
        orderBy: { dueDate: "asc" },
      },
      bookings: {
        select: {
          id: true,
          checkIn: true,
          checkOut: true,
          status: true,
          totalSaleVnd: true,
          villa: { select: { name: true } },
        },
        orderBy: { checkIn: "desc" },
      },
      _count: { select: { bookings: true } },
    },
  });
  if (!row) return null;

  const { receivables, bookings, _count, ...partner } = row;
  const base = aggregate(partner as Partner, receivables, _count.bookings, asOf);
  return {
    ...base,
    receivables,
    bookings: bookings.map((b) => ({
      id: b.id,
      villaName: b.villa.name,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      status: b.status,
      totalSaleVnd: b.totalSaleVnd,
    })),
  };
}
