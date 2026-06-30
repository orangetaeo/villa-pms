// lib/partner-portal.ts — 파트너 포털 스코프 데이터 로더 (ADR-0028 PP3)
//
// ★ 절대 누수 규칙 (사업원칙 2):
//   - 모든 함수는 partnerId 인자를 강제로 받고 where: { partnerId } 로만 조회한다(IDOR 차단).
//   - 응답에 절대 포함 금지: 미니바·서비스 주문(ServiceOrder)·운영자 매입원가(costVnd)·마진·
//     KRW 판매가(totalSaleKrw)·타 파트너 데이터·전체 재고·게스트 체크인(/g) 데이터.
//   - 파트너가 보는 금액 = 자기 채권(PartnerReceivable)·청구서(PartnerInvoice)의 VND뿐(정당하게 청구되는 금액).
//   - BigInt는 컴포넌트(클라이언트 직렬화) 전달용으로 string 변환.
import { prisma } from "@/lib/prisma";
import { outstandingForPartner, receivableOutstanding } from "@/lib/partner";
import { parseUtcDateOnly, todayVnDateString } from "@/lib/date-vn";

// ── 직렬화 타입 ──────────────────────────────────────────────────────────────

export interface PartnerBookingRow {
  id: string;
  villaName: string;
  villaNameVi: string | null;
  villaComplex: string | null;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  guestName: string;
  guestCount: number;
  status: string;
  /** 객실료 = 연결된 receivable.totalVnd(있으면) 없으면 booking.totalSaleVnd. VND string. */
  roomChargeVnd: string | null;
}

export interface PartnerBookingDetail extends PartnerBookingRow {
  /** 실제 투숙객 명단(자유 텍스트, 체크인 전 준비용). 없으면 null. */
  guestRoster: string | null;
  /** 명단 편집 가능 여부 — HOLD/CONFIRMED만(체크인 이후·취소·만료는 잠금). */
  canEditRoster: boolean;
}

export interface PartnerReceivableRow {
  id: string;
  villaName: string;
  villaNameVi: string | null;
  checkIn: Date;
  checkOut: Date;
  totalVnd: string;
  /** 선금 청구액(depositDueVnd). 잔금 청구액 = totalVnd - depositDueVnd. (선금율 자체는 비노출) */
  depositDueVnd: string;
  depositPaidVnd: string;
  balancePaidVnd: string;
  /** 잔액 = totalVnd - depositPaidVnd - balancePaidVnd */
  outstandingVnd: string;
  dueDate: Date;
  status: string;
}

export interface PartnerInvoiceRow {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  totalVnd: string;
  paidVnd: string;
  status: string;
  issuedAt: Date | null;
}

export interface PartnerReceivableStats {
  openCount: number; // 잔액>0 채권 건수
  overdueCount: number; // 연체(dueDate 지남 + 잔액>0) 건수
  notDueVnd: string; // 미연체 미수 합
  overdueVnd: string; // 연체 미수 합
  /** 연체 구간별 미수(연체일 기준): 1~7 / 8~30 / 30+ */
  aging: { d1_7: string; d8_30: string; d30plus: string };
}

export interface PartnerReceivablesResult {
  receivables: PartnerReceivableRow[];
  invoices: PartnerInvoiceRow[];
  summary: {
    totalBilledVnd: string; // Σ totalVnd
    totalPaidVnd: string; // Σ (depositPaidVnd + balancePaidVnd)
    outstandingVnd: string; // Σ (totalVnd - depositPaidVnd - balancePaidVnd)
  };
  stats: PartnerReceivableStats;
}

/**
 * 파트너 미수 통계 — 채권 행(잔액·기한)에서 미연체/연체·연체 구간 집계. 순수함수(테스트 대상).
 * today·dueDate는 UTC 자정(@db.Date) 기준. 잔액 0 건은 제외. Number 변환 금지(BigInt 합산).
 */
export function computePartnerReceivableStats(
  rows: readonly { outstandingVnd: string; dueDate: Date }[],
  today: Date
): PartnerReceivableStats {
  const MS = 86_400_000;
  const todayMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let openCount = 0;
  let overdueCount = 0;
  let notDue = 0n;
  let overdue = 0n;
  let d1_7 = 0n;
  let d8_30 = 0n;
  let d30plus = 0n;
  for (const r of rows) {
    const out = BigInt(r.outstandingVnd);
    if (out <= 0n) continue;
    openCount += 1;
    const dueMid = Date.UTC(
      r.dueDate.getUTCFullYear(),
      r.dueDate.getUTCMonth(),
      r.dueDate.getUTCDate()
    );
    const daysPast = Math.floor((todayMid - dueMid) / MS);
    if (daysPast <= 0) {
      notDue += out;
    } else {
      overdueCount += 1;
      overdue += out;
      if (daysPast <= 7) d1_7 += out;
      else if (daysPast <= 30) d8_30 += out;
      else d30plus += out;
    }
  }
  return {
    openCount,
    overdueCount,
    notDueVnd: notDue.toString(),
    overdueVnd: overdue.toString(),
    aging: { d1_7: d1_7.toString(), d8_30: d8_30.toString(), d30plus: d30plus.toString() },
  };
}

export interface PartnerProposalRow {
  token: string;
  expiresAt: Date;
  status: string;
  itemCount: number;
}

// ── 로더 ────────────────────────────────────────────────────────────────────

/**
 * 파트너 예약 현황 — where: { partnerId } 강제. 최신순.
 * ★ totalSaleKrw·supplierCostVnd·미니바·서비스 일절 select 금지.
 * 객실료는 receivable.totalVnd 우선, 없으면 totalSaleVnd(VND 채널만 의미 — KRW 채널은 null).
 */
export async function loadPartnerBookings(
  partnerId: string
): Promise<PartnerBookingRow[]> {
  const bookings = await prisma.booking.findMany({
    where: { partnerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      guestName: true,
      guestCount: true,
      status: true,
      totalSaleVnd: true,
      villa: { select: { name: true, nameVi: true, complex: true } },
      receivable: { select: { totalVnd: true } },
    },
  });

  return bookings.map((b) => {
    const charge = b.receivable?.totalVnd ?? b.totalSaleVnd ?? null;
    return {
      id: b.id,
      villaName: b.villa.name,
      villaNameVi: b.villa.nameVi,
      villaComplex: b.villa.complex,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      nights: b.nights,
      guestName: b.guestName,
      guestCount: b.guestCount,
      status: b.status,
      roomChargeVnd: charge !== null ? charge.toString() : null,
    };
  });
}

/**
 * 파트너 단일 예약 상세 — where: { id, partnerId } 동시 조건(IDOR 차단). 미소유/미존재면 null.
 * ★ totalSaleKrw·supplierCostVnd·미니바·서비스 일절 select 금지(목록 로더와 동일 누수 규칙).
 * guestRoster 포함(명단 사전 제출용). canEditRoster = HOLD/CONFIRMED.
 */
export async function loadPartnerBookingDetail(
  partnerId: string,
  bookingId: string
): Promise<PartnerBookingDetail | null> {
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, partnerId },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      guestName: true,
      guestCount: true,
      status: true,
      guestRoster: true,
      totalSaleVnd: true,
      villa: { select: { name: true, nameVi: true, complex: true } },
      receivable: { select: { totalVnd: true } },
    },
  });
  if (!b) return null;

  const charge = b.receivable?.totalVnd ?? b.totalSaleVnd ?? null;
  return {
    id: b.id,
    villaName: b.villa.name,
    villaNameVi: b.villa.nameVi,
    villaComplex: b.villa.complex,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    guestName: b.guestName,
    guestCount: b.guestCount,
    status: b.status,
    roomChargeVnd: charge !== null ? charge.toString() : null,
    guestRoster: b.guestRoster,
    // 체크인 이후·취소·만료는 잠금(명단은 체크인 전 준비용) — 공개 roster route와 동일 규칙.
    canEditRoster: b.status === "HOLD" || b.status === "CONFIRMED",
  };
}

/**
 * 파트너 미수(채권 + 청구서) + 요약. where: { partnerId } 강제.
 * 미수잔액 = Σ(totalVnd - depositPaidVnd - balancePaidVnd). BigInt 합산(Number 변환 금지).
 */
export async function loadPartnerReceivables(
  partnerId: string
): Promise<PartnerReceivablesResult> {
  const [receivables, invoices] = await Promise.all([
    prisma.partnerReceivable.findMany({
      where: { partnerId },
      orderBy: { dueDate: "desc" },
      select: {
        id: true,
        totalVnd: true,
        depositDueVnd: true,
        depositPaidVnd: true,
        balancePaidVnd: true,
        dueDate: true,
        status: true,
        booking: {
          select: {
            checkIn: true,
            checkOut: true,
            villa: { select: { name: true, nameVi: true } },
          },
        },
      },
    }),
    prisma.partnerInvoice.findMany({
      where: { partnerId },
      orderBy: { periodStart: "desc" },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        dueDate: true,
        totalVnd: true,
        paidVnd: true,
        status: true,
        issuedAt: true,
      },
    }),
  ]);

  let totalBilled = 0n;
  let totalPaid = 0n;
  // 미수 잔액은 운영자(outstandingForPartner)와 동일 규칙으로 산출 — 완납·대손 제외 + 음수 클램프(H2).
  //   옛 동작: 상태 무관 Σ(total−paid)라 대손 채권까지 미수에 포함 → 파트너 화면이 운영자보다 큰 미수 표시.
  //   총청구·총납부는 이력 합계(전 상태)라 그대로 두며, 차액(=대손액)은 미수가 아님.
  const outstanding = outstandingForPartner(receivables);

  const receivableRows: PartnerReceivableRow[] = receivables.map((r) => {
    const paid = r.depositPaidVnd + r.balancePaidVnd;
    const out = receivableOutstanding(r); // 음수 클램프(0 하한) — 행 표시도 운영자와 일관
    totalBilled += r.totalVnd;
    totalPaid += paid;
    return {
      id: r.id,
      villaName: r.booking.villa.name,
      villaNameVi: r.booking.villa.nameVi,
      checkIn: r.booking.checkIn,
      checkOut: r.booking.checkOut,
      totalVnd: r.totalVnd.toString(),
      depositDueVnd: r.depositDueVnd.toString(),
      depositPaidVnd: r.depositPaidVnd.toString(),
      balancePaidVnd: r.balancePaidVnd.toString(),
      outstandingVnd: out.toString(),
      dueDate: r.dueDate,
      status: r.status,
    };
  });

  const invoiceRows: PartnerInvoiceRow[] = invoices.map((i) => ({
    id: i.id,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    dueDate: i.dueDate,
    totalVnd: i.totalVnd.toString(),
    paidVnd: i.paidVnd.toString(),
    status: i.status,
    issuedAt: i.issuedAt,
  }));

  // 미수 통계 — VN 오늘 기준 미연체/연체 집계
  const today = parseUtcDateOnly(todayVnDateString()) ?? new Date();
  const stats = computePartnerReceivableStats(receivableRows, today);

  return {
    receivables: receivableRows,
    invoices: invoiceRows,
    summary: {
      totalBilledVnd: totalBilled.toString(),
      totalPaidVnd: totalPaid.toString(),
      outstandingVnd: outstanding.toString(),
    },
    stats,
  };
}

/**
 * 파트너가 받은 제안서 목록. where: { partnerId } 강제. 현재 0건일 수 있음(빈 상태 UI).
 * 빌라 상세·가격은 노출하지 않고 개수만 — 상세는 /p/[token] 공개 링크로 위임.
 */
export async function loadPartnerProposals(
  partnerId: string
): Promise<PartnerProposalRow[]> {
  const proposals = await prisma.proposal.findMany({
    where: { partnerId },
    orderBy: { createdAt: "desc" },
    select: {
      token: true,
      expiresAt: true,
      status: true,
      _count: { select: { items: true } },
    },
  });

  return proposals.map((p) => ({
    token: p.token,
    expiresAt: p.expiresAt,
    status: p.status,
    itemCount: p._count.items,
  }));
}
