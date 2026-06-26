// lib/revenue-ledger.ts — 매출관리(건별 매출 거래 목록) 단일 소스 (운영자 ADMIN 전용)
//
// 객실료(Booking)·미니바(CheckoutMinibarLine)·부가서비스(ServiceOrder)를 하나의
// 거래 행(RevenueTxn)으로 통합한다. /revenue 페이지·CSV export가 이 모듈만 호출한다.
//
// ★ ADMIN/운영자(canViewFinance) 전용. 마진·판매가(KRW·VND)·원가는 OWNER·MANAGER만 —
//   STAFF·공급자·공개(/p)에 절대 노출 금지. 게이트는 호출부(page·route)가 책임지며,
//   이 모듈은 재무 데이터를 항상 계산한다(누수 차단은 권한 검사가 끝난 뒤 호출하는 것으로 보장).
//
// 금액 규칙(money-pattern·CLAUDE.md):
//  - VND는 BigInt, KRW는 Int. 합산은 BigInt로만(부동소수점 금지). 통화(KRW·VND)는 절대 합산하지 않는다(ADR-0003).
//  - 마진은 VND만 계산한다. KRW 채널 객실료는 VND 원가만 알 수 있어 KRW 매출-VND 원가 혼합 마진이
//    의미가 없으므로 VND 마진에서 제외한다(ADR-0003). costVnd가 없으면 marginVnd=null.
//  - 매출 인식 = 체크아웃월 기준(귀속일=Booking.checkOut), SETTLEMENT_BOOKING_STATUSES(CHECKED_OUT·NO_SHOW)와 정합.
//  - 기간은 [from, to) half-open.

import {
  BookingChannel,
  BookingStatus,
  ServiceOrderStatus,
  Currency,
  type ServiceType,
  type PrismaClient,
} from "@prisma/client";
import { SETTLEMENT_BOOKING_STATUSES } from "@/lib/settlement";

// ===================================================================
// 타입
// ===================================================================

export type RevenueTxnType = "ROOM" | "MINIBAR" | "SERVICE";

/** 통합 매출 거래 행 — 직렬화 전(서버 내부) 형태. VND는 BigInt. */
export interface RevenueTxn {
  /** 행 고유 id — "ROOM:<bookingId>" / "MINIBAR:<lineId>" / "SERVICE:<orderId>" */
  id: string;
  /** 귀속일(체크아웃월 기준 일자) "YYYY-MM-DD" */
  date: string;
  type: RevenueTxnType;
  villaId: string;
  villaName: string;
  /** 객실료만 — BookingChannel. 미니바·부가서비스는 null */
  channel: BookingChannel | null;
  /** 파트너(여행사·랜드사) 표시명 — 없으면 agencyName 폴백, 둘 다 없으면 null */
  partnerName: string | null;
  /** 투숙객명(ROOM) 또는 품목명/서비스명(MINIBAR·SERVICE) */
  label: string;
  /** 판매가 KRW — KRW 채널 객실료만. 그 외 null */
  saleKrw: number | null;
  /** 판매가 VND — VND 채널 객실료·미니바·부가서비스(VND). 그 외 null */
  saleVnd: bigint | null;
  /** 매입 원가 VND — 미입력이면 null(마진 산입 제외) */
  costVnd: bigint | null;
  /** 마진 VND = saleVnd − costVnd. saleVnd·costVnd 중 하나라도 없으면 null */
  marginVnd: bigint | null;
}

/** 통화별 합계 — KRW·VND 분리(절대 합산 금지) */
export interface RevenueTotals {
  /** 행 수 */
  count: number;
  /** KRW 매출 합계(Int) — KRW 채널 객실료 */
  saleKrw: number;
  /** VND 매출 합계(BigInt) — VND 채널 객실료·미니바·부가서비스 */
  saleVnd: bigint;
  /** VND 원가 합계(BigInt) — costVnd 있는 행만 */
  costVnd: bigint;
  /** VND 마진 합계(BigInt) — marginVnd 있는 행만 */
  marginVnd: bigint;
}

export interface LoadRevenueResult {
  txns: RevenueTxn[];
  totals: RevenueTotals;
}

export interface RevenueFilter {
  /** 귀속일 시작(포함) "YYYY-MM-DD" → UTC 자정 Date */
  from: Date;
  /** 귀속일 끝(미포함) "YYYY-MM-DD" → UTC 자정 Date (half-open) */
  to: Date;
  /** 유형 필터 — 미지정이면 전체 */
  types?: RevenueTxnType[];
  /** 채널 필터(객실료에만 의미). 지정 시 ROOM만 남고 해당 채널만 */
  channel?: BookingChannel;
  villaId?: string;
  partnerId?: string;
  /** 통화 필터 — KRW/VND. saleKrw·saleVnd 보유 여부로 판정 */
  currency?: Currency;
  /** 전체 예약 상태 포함(기본 false=매출인식 상태 CHECKED_OUT·NO_SHOW만) */
  includeAllStatuses?: boolean;
}

// ===================================================================
// 순수 함수 층 (단위 테스트 대상 — DB 무관)
// ===================================================================

/** UTC 자정 Date → "YYYY-MM-DD" (귀속일 산출용) */
function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 마진 산출 — VND만. saleVnd·costVnd 둘 다 있어야 마진(둘 중 하나라도 null이면 null).
 * KRW 채널 객실료(saleVnd=null)는 자동으로 marginVnd=null이 된다(ADR-0003).
 */
export function computeMarginVnd(saleVnd: bigint | null, costVnd: bigint | null): bigint | null {
  if (saleVnd === null || costVnd === null) return null;
  return saleVnd - costVnd;
}

/**
 * 통화별 합계 — BigInt 누적(부동소수점 금지). KRW·VND 분리(절대 합산 금지).
 *  - saleKrw: KRW 매출 있는 행만(Int 누적)
 *  - saleVnd/costVnd/marginVnd: 해당 값 있는 행만(BigInt 누적)
 */
export function sumRevenueTotals(txns: RevenueTxn[]): RevenueTotals {
  let saleKrw = 0;
  let saleVnd = 0n;
  let costVnd = 0n;
  let marginVnd = 0n;
  for (const t of txns) {
    if (t.saleKrw !== null) saleKrw += t.saleKrw;
    if (t.saleVnd !== null) saleVnd += t.saleVnd;
    if (t.costVnd !== null) costVnd += t.costVnd;
    if (t.marginVnd !== null) marginVnd += t.marginVnd;
  }
  return { count: txns.length, saleKrw, saleVnd, costVnd, marginVnd };
}

/** 통화 필터 통과 여부 — KRW=saleKrw 보유 행, VND=saleVnd 보유 행. USD는 현재 매출원천 없음 → 전부 제외. */
function passesCurrency(txn: RevenueTxn, currency?: Currency): boolean {
  if (!currency) return true;
  if (currency === Currency.KRW) return txn.saleKrw !== null;
  if (currency === Currency.VND) return txn.saleVnd !== null;
  return false; // USD: 매출 원천 없음
}

// ===================================================================
// 행 빌더 (DB 행 → RevenueTxn) — 순수, 테스트 대상
// ===================================================================

/** Booking 1행 → ROOM RevenueTxn. saleCurrency에 따라 KRW/VND 컬럼 1개만 채운다(ADR-0003). */
export interface RoomRow {
  id: string;
  checkOut: Date;
  villaId: string;
  villaName: string;
  channel: BookingChannel;
  partnerName: string | null;
  agencyName: string | null;
  guestName: string;
  saleCurrency: Currency;
  totalSaleKrw: number | null;
  totalSaleVnd: bigint | null;
  supplierCostVnd: bigint;
}

export function buildRoomTxn(b: RoomRow): RevenueTxn {
  // saleCurrency에 해당하는 통화 컬럼만 매출로 인정(HOLD 시점 스냅샷 규칙).
  const saleKrw = b.saleCurrency === Currency.KRW ? b.totalSaleKrw : null;
  const saleVnd = b.saleCurrency === Currency.VND ? b.totalSaleVnd : null;
  // 원가는 항상 VND(supplierCostVnd, not null). 단 마진은 VND 매출일 때만 의미.
  const costVnd = b.supplierCostVnd;
  return {
    id: `ROOM:${b.id}`,
    date: dateOnly(b.checkOut),
    type: "ROOM",
    villaId: b.villaId,
    villaName: b.villaName,
    channel: b.channel,
    partnerName: b.partnerName ?? b.agencyName ?? null,
    label: b.guestName,
    saleKrw,
    saleVnd,
    costVnd,
    marginVnd: computeMarginVnd(saleVnd, costVnd),
  };
}

/** CheckoutMinibarLine 1행 → MINIBAR RevenueTxn (VND 전용). */
export interface MinibarRow {
  id: string;
  checkOut: Date;
  villaId: string;
  villaName: string;
  nameKo: string;
  consumedQty: number;
  lineVnd: bigint;
  lineCostVnd: bigint | null;
}

export function buildMinibarTxn(l: MinibarRow): RevenueTxn {
  const saleVnd = l.lineVnd;
  const costVnd = l.lineCostVnd;
  return {
    id: `MINIBAR:${l.id}`,
    date: dateOnly(l.checkOut),
    type: "MINIBAR",
    villaId: l.villaId,
    villaName: l.villaName,
    channel: null,
    partnerName: null,
    label: l.consumedQty > 1 ? `${l.nameKo} ×${l.consumedQty}` : l.nameKo,
    saleKrw: null,
    saleVnd,
    costVnd,
    marginVnd: computeMarginVnd(saleVnd, costVnd),
  };
}

/**
 * ServiceOrder 1행 → SERVICE RevenueTxn. priceVnd 있으면 VND, 없으면 KRW로 인식(ADR-0003 분리).
 * priceKrw·priceVnd·costVnd는 DB 저장값(이미 라인 합계, 미니바 lineVnd와 동형)을 그대로 주입한다 — ×수량 금지.
 */
export interface ServiceRow {
  id: string;
  checkOut: Date;
  villaId: string;
  villaName: string;
  serviceType: ServiceType;
  serviceLabel: string; // 표시명(번역된 라벨 — 호출부가 주입)
  quantity: number; // 라벨 표기(×N)용. 금액은 이미 라인 합계라 곱하지 않음.
  priceKrw: number; // 라인 합계 KRW (DB 저장값 그대로)
  priceVnd: bigint | null; // 라인 합계 VND (DB 저장값 그대로), KRW 채널이면 null
  costVnd: bigint; // 라인 합계 원가 VND (DB 저장값 그대로)
}

export function buildServiceTxn(o: ServiceRow): RevenueTxn {
  // 통화 인식: priceVnd가 채워진 주문(현지·여행사 채널)은 VND, 아니면 KRW(주문 시점 환율 스냅샷).
  const isVnd = o.priceVnd !== null;
  const saleVnd = isVnd ? o.priceVnd : null;
  const saleKrw = isVnd ? null : o.priceKrw;
  // 원가는 VND. 마진은 VND 매출일 때만(KRW 매출은 marginVnd=null, ADR-0003).
  const costVnd = o.costVnd;
  const label = o.quantity > 1 ? `${o.serviceLabel} ×${o.quantity}` : o.serviceLabel;
  return {
    id: `SERVICE:${o.id}`,
    date: dateOnly(o.checkOut),
    type: "SERVICE",
    villaId: o.villaId,
    villaName: o.villaName,
    channel: null,
    partnerName: null,
    label,
    saleKrw,
    saleVnd,
    costVnd,
    marginVnd: computeMarginVnd(saleVnd, costVnd),
  };
}

// ===================================================================
// DB 로더
// ===================================================================

/** 호출부가 ServiceType → 표시 라벨로 변환하는 함수(번역 주입). 미지정이면 enum 값 그대로. */
export type ServiceLabeler = (type: ServiceType) => string;

/**
 * 기간·필터로 통합 매출 거래 목록 + 통화별 합계를 로드한다.
 *
 * - 귀속일 = Booking.checkOut(half-open [from, to)). 미니바·부가서비스도 booking.checkOut으로 귀속.
 * - 기본 매출인식 상태(CHECKED_OUT·NO_SHOW)만. includeAllStatuses=true면 전체 상태.
 * - types 필터로 ROOM/MINIBAR/SERVICE 부분 로드(불필요 쿼리 회피).
 * - channel 필터가 지정되면 ROOM만 의미가 있으므로 MINIBAR·SERVICE는 자동 제외.
 * - currency 필터·partnerId(미니바·서비스는 파트너 귀속 없음 → ROOM만)는 후처리에서 적용.
 *
 * ★ 권한 검사는 호출부(page·route)가 끝낸 뒤 호출할 것(이 함수는 재무 데이터를 항상 반환).
 */
export async function loadRevenueTxns(
  db: PrismaClient,
  filter: RevenueFilter,
  serviceLabeler?: ServiceLabeler
): Promise<LoadRevenueResult> {
  const { from, to } = filter;

  // 매출인식 상태 게이트 — 기본은 CHECKED_OUT·NO_SHOW, 전체 토글 시 미지정(전 상태).
  const statusWhere = filter.includeAllStatuses
    ? undefined
    : { in: [...SETTLEMENT_BOOKING_STATUSES] as BookingStatus[] };

  // 채널 필터가 걸리면 미니바·부가서비스는 의미가 없으므로 ROOM만 로드.
  const channelFilterActive = filter.channel != null;
  const wantType = (t: RevenueTxnType) => {
    if (filter.types && !filter.types.includes(t)) return false;
    if (channelFilterActive && t !== "ROOM") return false;
    return true;
  };
  // partnerId 필터는 ROOM에만 귀속(미니바·서비스는 파트너 없음).
  const partnerFilterActive = filter.partnerId != null;
  const nonRoomBlockedByPartner = partnerFilterActive;

  const bookingWhere = {
    checkOut: { gte: from, lt: to },
    ...(statusWhere ? { status: statusWhere } : {}),
    ...(filter.channel ? { channel: filter.channel } : {}),
    ...(filter.villaId ? { villaId: filter.villaId } : {}),
    ...(filter.partnerId ? { partnerId: filter.partnerId } : {}),
  };

  const txns: RevenueTxn[] = [];

  // ── ROOM(객실료) ──
  if (wantType("ROOM")) {
    const bookings = await db.booking.findMany({
      where: bookingWhere,
      select: {
        id: true,
        checkOut: true,
        villaId: true,
        channel: true,
        agencyName: true,
        guestName: true,
        saleCurrency: true,
        totalSaleKrw: true,
        totalSaleVnd: true,
        supplierCostVnd: true,
        villa: { select: { name: true } },
        partner: { select: { name: true } },
      },
    });
    for (const b of bookings) {
      txns.push(
        buildRoomTxn({
          id: b.id,
          checkOut: b.checkOut,
          villaId: b.villaId,
          villaName: b.villa.name,
          channel: b.channel,
          partnerName: b.partner?.name ?? null,
          agencyName: b.agencyName,
          guestName: b.guestName,
          saleCurrency: b.saleCurrency,
          totalSaleKrw: b.totalSaleKrw,
          totalSaleVnd: b.totalSaleVnd,
          supplierCostVnd: b.supplierCostVnd,
        })
      );
    }
  }

  // ── MINIBAR(미니바) ── 파트너 필터 시 제외(미니바는 파트너 귀속 없음)
  if (wantType("MINIBAR") && !nonRoomBlockedByPartner) {
    const lines = await db.checkoutMinibarLine.findMany({
      where: {
        checkOutRecord: {
          booking: {
            checkOut: { gte: from, lt: to },
            ...(statusWhere ? { status: statusWhere } : {}),
            ...(filter.villaId ? { villaId: filter.villaId } : {}),
          },
        },
      },
      select: {
        id: true,
        nameKo: true,
        consumedQty: true,
        lineVnd: true,
        lineCostVnd: true,
        checkOutRecord: {
          select: {
            booking: {
              select: {
                checkOut: true,
                villaId: true,
                villa: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    for (const l of lines) {
      const bk = l.checkOutRecord.booking;
      txns.push(
        buildMinibarTxn({
          id: l.id,
          checkOut: bk.checkOut,
          villaId: bk.villaId,
          villaName: bk.villa.name,
          nameKo: l.nameKo,
          consumedQty: l.consumedQty,
          lineVnd: l.lineVnd,
          lineCostVnd: l.lineCostVnd,
        })
      );
    }
  }

  // ── SERVICE(부가서비스) ── CONFIRMED·DELIVERED만. 파트너 필터 시 제외.
  if (wantType("SERVICE") && !nonRoomBlockedByPartner) {
    const orders = await db.serviceOrder.findMany({
      where: {
        status: { in: [ServiceOrderStatus.CONFIRMED, ServiceOrderStatus.DELIVERED] },
        booking: {
          checkOut: { gte: from, lt: to },
          ...(statusWhere ? { status: statusWhere } : {}),
          ...(filter.villaId ? { villaId: filter.villaId } : {}),
        },
      },
      select: {
        id: true,
        type: true,
        quantity: true,
        priceKrw: true,
        priceVnd: true,
        costVnd: true,
        booking: {
          select: {
            checkOut: true,
            villaId: true,
            villa: { select: { name: true } },
          },
        },
      },
    });
    for (const o of orders) {
      const qty = o.quantity > 0 ? o.quantity : 1;
      txns.push(
        buildServiceTxn({
          id: o.id,
          checkOut: o.booking.checkOut,
          villaId: o.booking.villaId,
          villaName: o.booking.villa.name,
          serviceType: o.type,
          serviceLabel: serviceLabeler ? serviceLabeler(o.type) : String(o.type),
          quantity: qty,
          // priceKrw·priceVnd·costVnd는 DB에 이미 라인 합계(단가×수량)로 저장됨(service-catalog resolveOrderPricing).
          // statistics.ts loadServiceOrderStats와 동일하게 ×수량 없이 그대로 합산(이중계산 금지·ADR-0003).
          priceKrw: o.priceKrw,
          priceVnd: o.priceVnd,
          costVnd: o.costVnd,
        })
      );
    }
  }

  // ── 후처리 필터: currency(통화 보유 여부) ──
  let filtered = txns;
  if (filter.currency) {
    filtered = filtered.filter((t) => passesCurrency(t, filter.currency));
  }

  // 정렬 — 귀속일 desc(최신 먼저), 동일일은 type 안정 순서.
  filtered.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { txns: filtered, totals: sumRevenueTotals(filtered) };
}
