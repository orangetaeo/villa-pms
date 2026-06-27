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

export interface PartnerReceivableRow {
  id: string;
  villaName: string;
  villaNameVi: string | null;
  checkIn: Date;
  checkOut: Date;
  totalVnd: string;
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

export interface PartnerReceivablesResult {
  receivables: PartnerReceivableRow[];
  invoices: PartnerInvoiceRow[];
  summary: {
    totalBilledVnd: string; // Σ totalVnd
    totalPaidVnd: string; // Σ (depositPaidVnd + balancePaidVnd)
    outstandingVnd: string; // Σ (totalVnd - depositPaidVnd - balancePaidVnd)
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

  return {
    receivables: receivableRows,
    invoices: invoiceRows,
    summary: {
      totalBilledVnd: totalBilled.toString(),
      totalPaidVnd: totalPaid.toString(),
      outstandingVnd: outstanding.toString(),
    },
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
