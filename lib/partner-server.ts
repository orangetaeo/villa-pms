import type { Partner, PrismaClient } from "@prisma/client";
import {
  agingBuckets,
  hasOverdue,
  outstandingForPartner,
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
    aging: agingBuckets(receivables, asOf),
    overdue: hasOverdue(receivables, asOf),
    bookingCount,
  };
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
