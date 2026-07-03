// lib/partner-portal.ts — 파트너 포털 스코프 데이터 로더 (ADR-0028 PP3)
//
// ★ 절대 누수 규칙 (사업원칙 2):
//   - 모든 함수는 partnerId 인자를 강제로 받고 where: { partnerId } 로만 조회한다(IDOR 차단).
//   - 응답에 절대 포함 금지: 미니바·서비스 주문(ServiceOrder)·운영자 매입원가(costVnd)·마진·
//     KRW 판매가(totalSaleKrw)·타 파트너 데이터·전체 재고·게스트 체크인(/g) 데이터.
//   - 파트너가 보는 금액 = 자기 채권(PartnerReceivable)·청구서(PartnerInvoice)의 VND뿐(정당하게 청구되는 금액).
//   - BigInt는 컴포넌트(클라이언트 직렬화) 전달용으로 string 변환.
import { prisma } from "@/lib/prisma";
import {
  computeDepositDue,
  outstandingForPartner,
  receivableOutstanding,
} from "@/lib/partner";
import { invoiceDisplayNo } from "@/lib/partner-invoice";
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
  /** 연장(분할숙박) 자식 예약 여부 — parentBookingId 존재 (ADR-0030) */
  isExtension: boolean;
  /** 이 예약에 연결된 연장 자식 예약 수 */
  extensionCount: number;
}

/** 연장 묶음 표시용 — 부모/자식 상호 링크 행(누수 규칙 동일: 정당 VND만) */
export interface PartnerLinkedBookingRow {
  id: string;
  villaName: string;
  villaNameVi: string | null;
  checkIn: Date;
  checkOut: Date;
  status: string;
  roomChargeVnd: string | null;
}

/** 파트너 요청(취소·변경·홀드연장) 표시 행 */
export interface PartnerChangeRequestRow {
  id: string;
  kind: string; // CANCEL | MODIFY | HOLD_EXTEND
  status: string; // PENDING | APPROVED | REJECTED
  note: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface PartnerBookingDetail extends PartnerBookingRow {
  /** 실제 투숙객 명단(자유 텍스트, 체크인 전 준비용). 없으면 null. */
  guestRoster: string | null;
  /** 명단 편집 가능 여부 — HOLD/CONFIRMED만(체크인 이후·취소·만료는 잠금). */
  canEditRoster: boolean;
  /** HOLD 만료 시각 — 파트너가 언제까지 확정해야 하는지(HOLD 외 null) */
  holdExpiresAt: Date | null;
  /** 미납 잔액(연결 채권 기준, 0 하한). 채권 미생성(HOLD 등)이면 null. */
  outstandingVnd: string | null;
  /** HOLD 확정용 선금 금액 — computeDepositDue(객실료, 파트너 선금율). 금액만(비율 자체 비노출). HOLD 외 null. */
  holdDepositVnd: string | null;
  /** 연장 부모(내가 자식일 때) */
  parentBooking: PartnerLinkedBookingRow | null;
  /** 연장 자식들(내가 부모일 때) */
  extensions: PartnerLinkedBookingRow[];
  /** 연장 묶음 합계(본 예약 + 자식들 객실료 합, 묶음이 있을 때만) */
  groupTotalVnd: string | null;
  /** 이 예약의 요청 이력(최신순 5건) */
  changeRequests: PartnerChangeRequestRow[];
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
  /** 예약 상세 링크용 */
  bookingId: string;
  /** 연장(분할숙박) 자식 예약의 채권 여부 — 묶음 대조 표시용 (ADR-0030) */
  isExtension: boolean;
  /** 기한 경과 일수(잔액>0일 때만, 아니면 0) — 서버 계산(하이드레이션 안전) */
  overdueDays: number;
  /** 본인 입금 내역(최신순) — 선금/잔금 반영 근거 (T-partner-info 3) */
  payments: PartnerPaymentRow[];
}

/** 기한 경과 일수 — dueDate·today는 UTC 자정(@db.Date). 잔액 없거나 미경과면 0. 순수함수(테스트 대상). */
export function overdueDaysFor(
  dueDate: Date,
  today: Date,
  outstandingVnd: bigint
): number {
  if (outstandingVnd <= 0n) return 0;
  const MS = 86_400_000;
  const dueMid = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const todayMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((todayMid - dueMid) / MS));
}

/** 채권별 본인 입금 내역 — 파트너가 낸 돈의 기록(정당 데이터, T-partner-info 3) */
export interface PartnerPaymentRow {
  id: string;
  receivedAt: Date;
  currency: string;
  /** 통화 단위 문자열 (KRW 원·VND 동·USD 정수 달러 — PR #89 규약) */
  amount: string;
  purpose: string; // DEPOSIT | BALANCE
}

export interface PartnerInvoiceRow {
  id: string;
  /** 표시번호(INV-XXXXXX) — PDF·Zalo와 동일 규칙, 검색 대상 */
  invoiceNo: string;
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

/** 제안 아이템 — 파트너에게 제시된 스냅샷 가격만(원가·마진·consumer가 비노출, T-partner-info 1) */
export interface PartnerProposalItemRow {
  id: string;
  villaName: string;
  villaNameVi: string | null;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  /** 제안 통화의 총액(최소단위 문자열) — saleCurrency에 해당하는 컬럼만 값 존재 */
  totalKrw: string | null;
  totalVnd: string | null;
  totalUsd: string | null;
  /** 이미 가예약/예약된 아이템 */
  booked: boolean;
}

export interface PartnerProposalRow {
  token: string;
  expiresAt: Date;
  status: string;
  itemCount: number;
  saleCurrency: string; // KRW | VND | USD — 아이템 가격 표기용
  items: PartnerProposalItemRow[];
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
      parentBookingId: true,
      // 본인 파트너 소유 연장만 집계 — 상세(toLinked partnerId 필터)와 일관 (T-partner-polish 5)
      _count: { select: { extensions: { where: { partnerId } } } },
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
      isExtension: b.parentBookingId !== null,
      extensionCount: b._count.extensions,
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
  // 연장 부모/자식 공통 select — 정당 VND(채권 총액/판매 VND)만, KRW·원가 없음.
  const linkedSelect = {
    id: true,
    checkIn: true,
    checkOut: true,
    status: true,
    partnerId: true,
    totalSaleVnd: true,
    villa: { select: { name: true, nameVi: true } },
    receivable: { select: { totalVnd: true } },
  } as const;

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
      holdExpiresAt: true,
      parentBookingId: true,
      parentBooking: { select: linkedSelect },
      extensions: { select: linkedSelect, orderBy: { checkIn: "asc" } },
      villa: { select: { name: true, nameVi: true, complex: true } },
      // 선금율은 서버 계산에만 사용 — 반환 shape엔 금액(holdDepositVnd)만 (비율 비노출 원칙)
      partner: { select: { depositRatePct: true } },
      receivable: {
        select: {
          totalVnd: true,
          depositPaidVnd: true,
          balancePaidVnd: true,
          status: true,
          dueDate: true,
        },
      },
      // 요청 이력(최신 5건) — 파트너 본인 것만(예약 자체가 partnerId 스코프)
      changeRequests: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          kind: true,
          status: true,
          note: true,
          resolutionNote: true,
          createdAt: true,
          resolvedAt: true,
        },
      },
    },
  });
  if (!b) return null;

  const toLinked = (
    row: {
      id: string;
      checkIn: Date;
      checkOut: Date;
      status: string;
      partnerId: string | null;
      totalSaleVnd: bigint | null;
      villa: { name: string; nameVi: string | null };
      receivable: { totalVnd: bigint } | null;
    } | null
  ): PartnerLinkedBookingRow | null => {
    // 방어: 연장 예약은 partnerId를 상속하지만, 다른 파트너 소유면 절대 노출하지 않는다.
    if (!row || row.partnerId !== partnerId) return null;
    const c = row.receivable?.totalVnd ?? row.totalSaleVnd ?? null;
    return {
      id: row.id,
      villaName: row.villa.name,
      villaNameVi: row.villa.nameVi,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      status: row.status,
      roomChargeVnd: c !== null ? c.toString() : null,
    };
  };

  const charge = b.receivable?.totalVnd ?? b.totalSaleVnd ?? null;
  const parentBooking = toLinked(b.parentBooking);
  const extensions = b.extensions
    .map((e) => toLinked(e))
    .filter((e): e is PartnerLinkedBookingRow => e !== null);

  // 묶음 합계 — 부모 관점(본 예약 + 자식들). 취소·만료 자식은 제외.
  let groupTotalVnd: string | null = null;
  if (extensions.length > 0) {
    let sum = charge ?? 0n;
    for (const e of extensions) {
      if (e.status === "CANCELLED" || e.status === "EXPIRED") continue;
      if (e.roomChargeVnd) sum += BigInt(e.roomChargeVnd);
    }
    groupTotalVnd = sum.toString();
  }

  // 미납 잔액(채권 기준, 0 하한) — 대손(WRITTEN_OFF)은 미수 아님.
  let outstandingVnd: string | null = null;
  if (b.receivable && b.receivable.status !== "WRITTEN_OFF") {
    const out = receivableOutstanding(b.receivable);
    outstandingVnd = out.toString();
  }

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
    isExtension: b.parentBookingId !== null,
    extensionCount: extensions.length,
    guestRoster: b.guestRoster,
    // 체크인 이후·취소·만료는 잠금(명단은 체크인 전 준비용) — 공개 roster route와 동일 규칙.
    canEditRoster: b.status === "HOLD" || b.status === "CONFIRMED",
    holdExpiresAt: b.status === "HOLD" ? b.holdExpiresAt : null,
    outstandingVnd,
    // HOLD 확정용 선금(금액만) — 채권 미생성 시점이라 파트너 선금율로 서버 계산 (T-partner-polish 1)
    holdDepositVnd:
      b.status === "HOLD" && charge !== null && b.partner
        ? computeDepositDue(charge, b.partner.depositRatePct).toString()
        : null,
    parentBooking,
    extensions,
    groupTotalVnd,
    changeRequests: b.changeRequests.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      note: r.note,
      resolutionNote: r.resolutionNote,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    })),
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
            id: true,
            checkIn: true,
            checkOut: true,
            parentBookingId: true,
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

  // 본인 입금 내역 (T-partner-info 3) — Payment.receivableId는 관계 미정의 컬럼이라 별도 조회.
  // ★ 이중 스코프: receivableId in(본인 채권) + partnerId(벨트&서스펜더). 금액·일시·용도만(내부 메모 미노출).
  const paymentsByReceivable = new Map<string, PartnerPaymentRow[]>();
  if (receivables.length > 0) {
    const paymentRows = await prisma.payment.findMany({
      where: {
        receivableId: { in: receivables.map((r) => r.id) },
        partnerId,
      },
      orderBy: { receivedAt: "desc" },
      select: {
        id: true,
        receivableId: true,
        receivedAt: true,
        currency: true,
        amount: true,
        purpose: true,
      },
    });
    for (const p of paymentRows) {
      if (!p.receivableId) continue;
      const list = paymentsByReceivable.get(p.receivableId) ?? [];
      list.push({
        id: p.id,
        receivedAt: p.receivedAt,
        currency: p.currency,
        amount: p.amount.toString(),
        purpose: p.purpose,
      });
      paymentsByReceivable.set(p.receivableId, list);
    }
  }

  let totalBilled = 0n;
  let totalPaid = 0n;
  // 미수 잔액은 운영자(outstandingForPartner)와 동일 규칙으로 산출 — 완납·대손 제외 + 음수 클램프(H2).
  //   옛 동작: 상태 무관 Σ(total−paid)라 대손 채권까지 미수에 포함 → 파트너 화면이 운영자보다 큰 미수 표시.
  //   총청구·총납부는 이력 합계(전 상태)라 그대로 두며, 차액(=대손액)은 미수가 아님.
  const outstanding = outstandingForPartner(receivables);

  // VN 오늘 — 연체 일수(행)·미수 통계 공용 기준
  const today = parseUtcDateOnly(todayVnDateString()) ?? new Date();

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
      bookingId: r.booking.id,
      isExtension: r.booking.parentBookingId !== null,
      overdueDays: overdueDaysFor(r.dueDate, today, out),
      payments: paymentsByReceivable.get(r.id) ?? [],
    };
  });

  const invoiceRows: PartnerInvoiceRow[] = invoices.map((i) => ({
    id: i.id,
    invoiceNo: invoiceDisplayNo(i.id),
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    dueDate: i.dueDate,
    totalVnd: i.totalVnd.toString(),
    paidVnd: i.paidVnd.toString(),
    status: i.status,
    issuedAt: i.issuedAt,
  }));

  // 미수 통계 — VN 오늘 기준 미연체/연체 집계 (today는 위에서 행 연체일수와 공용 산출)
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
      saleCurrency: true,
      // 아이템 = 파트너에게 제시된 스냅샷 — 정당 가격만 select (원가·마진·consumer가 없음)
      items: {
        orderBy: { checkIn: "asc" },
        select: {
          id: true,
          checkIn: true,
          checkOut: true,
          totalKrw: true,
          totalVnd: true,
          totalUsd: true,
          bookingId: true,
          villa: { select: { name: true, nameVi: true } },
        },
      },
    },
  });

  const MS = 86_400_000;
  return proposals.map((p) => ({
    token: p.token,
    expiresAt: p.expiresAt,
    status: p.status,
    itemCount: p.items.length,
    saleCurrency: p.saleCurrency,
    items: p.items.map((it) => ({
      id: it.id,
      villaName: it.villa.name,
      villaNameVi: it.villa.nameVi,
      checkIn: it.checkIn,
      checkOut: it.checkOut,
      nights: Math.round((it.checkOut.getTime() - it.checkIn.getTime()) / MS),
      totalKrw: it.totalKrw !== null ? it.totalKrw.toString() : null,
      totalVnd: it.totalVnd !== null ? it.totalVnd.toString() : null,
      totalUsd: it.totalUsd !== null ? it.totalUsd.toString() : null,
      booked: it.bookingId !== null,
    })),
  }));
}
