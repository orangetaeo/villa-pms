// lib/guest-checkin-load.ts — /g/[token] 게스트 셀프 체크인 데이터 로더 (ADR-0019 S3)
//
// ★ 누수 차단(§9): 게스트는 자기 예약 하나만. 원가·마진·타예약·전체재고·공급자 정보 절대 비노출.
//   미니바·옵션은 **판매가만** 노출(게스트 청구용). 카탈로그 costVnd는 select에서 제외.
import { prisma } from "./prisma";
import { guestTokenState, type GuestTokenState } from "./guest-checkin";
import {
  AGREEMENT_VERSION,
  AGREEMENT_DOC_TITLE,
  AGREEMENT_CLAUSES,
  buildClauseOrder,
} from "./agreement";
import { effectivePar } from "./minibar-inventory";

/** 동의서 언어맵(lib/agreement의 LangMap과 동형) — 미export 타입 회피. */
type LangMap = typeof AGREEMENT_DOC_TITLE;

export interface GuestMinibarLine {
  itemKey: string;
  nameKo: string;
  nameVi: string | null;
  qty: number; // 비치 수량(par)
  priceVnd: string; // 판매가(VND, 동) — 게스트 노출 OK
}

export interface GuestCatalogItem {
  id: string;
  type: string;
  nameKo: string;
  nameVi: string | null;
  nameEn: string | null;
  descKo: string | null;
  descVi: string | null;
  unitLabelKo: string | null;
  priceKrw: number | null;
  priceVnd: string | null;
  options: unknown; // variants/addons/modifiers — 판매가만(원가 없음)
}

export interface GuestCheckinData {
  state: GuestTokenState;
  bookingId: string;
  alreadySigned: boolean;
  booking: {
    villaName: string;
    complex: string | null;
    checkIn: string;
    checkOut: string;
    nights: number;
    guestCount: number;
    breakfastIncluded: boolean;
  } | null;
  amenities: { category: string; itemKey: string; customLabel: string | null }[];
  minibar: GuestMinibarLine[];
  catalog: GuestCatalogItem[];
  agreement: {
    version: string;
    hasPool: boolean;
    docTitle: LangMap;
    clauses: { key: string; content: LangMap }[];
  };
  requestedOrders: {
    id: string;
    type: string;
    status: string;
    quantity: number;
    priceKrw: number | null;
    priceVnd: string | null;
  }[];
}

/** 토큰으로 게스트 체크인 데이터 로드. 토큰 없음 → null(404). 만료·회수 → state만 채워 반환(안내 화면). */
export async function loadGuestCheckin(
  token: string,
  now: Date = new Date()
): Promise<GuestCheckinData | null> {
  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { bookingId: true, expiresAt: true, revokedAt: true, agreementSignedAt: true },
  });
  if (!t) return null;
  const state = guestTokenState(t, now);

  const emptyAgreement = {
    version: AGREEMENT_VERSION,
    hasPool: false,
    docTitle: AGREEMENT_DOC_TITLE,
    clauses: [] as { key: string; content: LangMap }[],
  };
  if (state !== "OK") {
    return {
      state,
      bookingId: t.bookingId,
      alreadySigned: t.agreementSignedAt != null,
      booking: null,
      amenities: [],
      minibar: [],
      catalog: [],
      agreement: emptyAgreement,
      requestedOrders: [],
    };
  }

  const booking = await prisma.booking.findUnique({
    where: { id: t.bookingId },
    select: {
      id: true,
      villaId: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      guestCount: true,
      breakfastIncluded: true,
      villa: { select: { name: true, complex: true, hasPool: true } },
    },
  });
  if (!booking) return null;

  const [amenityRows, minibarItems, villaStocks, catalogRows, orders] = await Promise.all([
    prisma.villaAmenity.findMany({
      where: { villaId: booking.villaId, category: { not: "MINIBAR" } },
      select: { category: true, itemKey: true, customLabel: true },
    }),
    prisma.minibarItem.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, itemKey: true, nameKo: true, nameVi: true, unitPriceVnd: true, stockQty: true },
    }),
    prisma.villaMinibarStock.findMany({
      where: { villaId: booking.villaId },
      select: { minibarItemId: true, qty: true },
    }),
    // ★ costVnd 미포함 — 게스트 비노출(판매가만)
    prisma.serviceCatalogItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, type: true, nameKo: true, nameVi: true, nameEn: true,
        descKo: true, descVi: true, unitLabelKo: true,
        priceKrw: true, priceVnd: true, options: true,
      },
    }),
    prisma.serviceOrder.findMany({
      where: { bookingId: t.bookingId, requestedVia: "GUEST" },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, status: true, quantity: true, priceKrw: true, priceVnd: true },
    }),
  ]);

  const stockMap = new Map(villaStocks.map((s) => [s.minibarItemId, s.qty]));
  const minibar: GuestMinibarLine[] = minibarItems
    .map((m) => ({
      itemKey: m.itemKey,
      nameKo: m.nameKo,
      nameVi: m.nameVi,
      qty: effectivePar(stockMap.get(m.id), m.stockQty),
      priceVnd: m.unitPriceVnd.toString(),
    }))
    .filter((m) => m.qty > 0);

  return {
    state,
    bookingId: t.bookingId,
    alreadySigned: t.agreementSignedAt != null,
    booking: {
      villaName: booking.villa.name,
      complex: booking.villa.complex,
      checkIn: booking.checkIn.toISOString(),
      checkOut: booking.checkOut.toISOString(),
      nights: booking.nights,
      guestCount: booking.guestCount,
      breakfastIncluded: booking.breakfastIncluded,
    },
    amenities: amenityRows,
    minibar,
    catalog: catalogRows.map((c) => ({
      id: c.id,
      type: c.type,
      nameKo: c.nameKo,
      nameVi: c.nameVi,
      nameEn: c.nameEn,
      descKo: c.descKo,
      descVi: c.descVi,
      unitLabelKo: c.unitLabelKo,
      priceKrw: c.priceKrw,
      priceVnd: c.priceVnd?.toString() ?? null,
      options: c.options,
    })),
    agreement: {
      version: AGREEMENT_VERSION,
      hasPool: booking.villa.hasPool,
      docTitle: AGREEMENT_DOC_TITLE,
      clauses: buildClauseOrder(booking.villa.hasPool).map((key) => ({
        key,
        content: AGREEMENT_CLAUSES[key],
      })),
    },
    requestedOrders: orders.map((o) => ({
      id: o.id,
      type: o.type,
      status: o.status,
      quantity: o.quantity,
      priceKrw: o.priceKrw,
      priceVnd: o.priceVnd?.toString() ?? null,
    })),
  };
}
