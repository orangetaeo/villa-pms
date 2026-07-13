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
import { stripOptionCosts, parseSelectedOptions, type ResolvedSelectedOption } from "./service-catalog";
import { getFxVndPerKrw } from "./pricing";
import { parseAudiences } from "./service-catalog";

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
  nameI18n: unknown; // {en,vi,zh,ru} — 게스트 언어전환용(pickI18n)
  descKo: string | null;
  descI18n: unknown;
  unitLabelKo: string | null;
  priceVnd: string | null; // 판매가 VND(동) — KRW는 fxVndPerKrw로 표시 시점 파생(priceKrwCeil)
  photoUrl: string | null;
  options: unknown; // {variants/addons/modifiers:[{key,labelKo,labelI18n,priceVnd}]} — 판매가만(원가 없음)
  pickupAvailable: boolean | null; // 마사지·이발 픽업: null=미정·true=픽업·false=직접방문
  pickupNote: string | null; // 픽업/매장 안내(주소·조건) — 그대로 표기
}

export interface GuestCheckinData {
  state: GuestTokenState;
  bookingId: string;
  alreadySigned: boolean;
  /** 체크아웃 완료(status=CHECKED_OUT) — 정산 내역(영수증) 진입점 노출 게이트(T-guest-settlement-receipt). */
  checkedOut: boolean;
  booking: {
    villaName: string;
    complex: string | null;
    checkIn: string;
    checkOut: string;
    nights: number;
    guestCount: number;
    breakfastIncluded: boolean;
    // ── 출입 정보(A1) — 게스트 토큰 로더 전용. /p 공개페이지엔 절대 미노출(원칙2). ──
    address: string | null; // 주소(있을 때만 지도 링크 생성)
    wifiSsid: string | null; // 와이파이 이름
    wifiPassword: string | null; // ⚠ 와이파이 비번 — FE는 동의서 서명(signed) 후에만 표시
    // 숙박 요금 — **직접 게스트(seller=OPERATOR·파트너 없음)만** 노출. 파트너/공급자 예약은 null
    //   (그쪽이 게스트와 별도로 정산하므로 우리 판매가를 게스트에 보이면 안 됨 — 원칙2).
    stayChargeVnd: string | null; // VND 채널
    stayChargeKrw: number | null; // KRW 채널
  } | null;
  // customLabelKo = custom 라벨의 ko 저장형 번역(null=미번역). ko 표면은 customLabelKo ?? customLabel로 표기.
  amenities: { category: string; itemKey: string; customLabel: string | null; customLabelKo: string | null }[];
  minibar: GuestMinibarLine[];
  catalog: GuestCatalogItem[];
  /** 현재 환율(1 KRW당 VND, 문자열). 미설정이면 null — FE가 priceKrwCeil로 게스트 KRW 표시. */
  fxVndPerKrw: string | null;
  agreement: {
    version: string;
    hasPool: boolean;
    docTitle: LangMap;
    clauses: { key: string; content: LangMap }[];
  };
  requestedOrders: {
    id: string;
    type: string;
    catalogItemId: string | null; // 픽업/이행 안내 해석용(카탈로그 픽업 설정 조회)
    status: string;
    quantity: number;
    priceKrw: number | null;
    priceVnd: string | null;
    /** 원천공급자에게 PO가 나간(살아있는) 주문 여부 — 레거시(취소 로직은 vendorAccepted 판정). */
    dispatched: boolean;
    /** 담당 벤더가 수락함(VENDOR_ACCEPTED) — true면 셀프 취소 불가·담당자 연락처 노출. */
    vendorAccepted: boolean;
    /** 담당 벤더 이름·전화 — 수락(확정) 후 게스트에 노출. ★이름·전화만(원가·bankInfo 절대 미포함). */
    vendorName: string | null;
    vendorPhone: string | null;
    /** 희망 날짜(YYYY-MM-DD) — @db.Date. 게스트 신청은 항상 존재(서버 필수 검증). */
    serviceDate: string | null;
    /** 희망 시간("HH:MM"). */
    serviceTime: string | null;
    // ── 벤더 시간 제안(propose) — 게스트 승인/거절 대상(ADR-0035). 판매가 무관 일정 필드만. ──
    /** 벤더가 제안한 대안 날짜(YYYY-MM-DD) — 없으면 null(제안 없음). */
    proposedServiceDate: string | null;
    /** 벤더가 제안한 대안 시간("HH:MM"). */
    proposedServiceTime: string | null;
    /** 제안 메모(벤더 사유). */
    vendorProposalNote: string | null;
    /** 미해결 제안 여부 — 제안 있고(proposedServiceDate) 아직 응답 전(respondedAt null)이면 true(게스트 응답 대기). */
    proposalPending: boolean;
    /** 선택한 variant·addon·modifier 스냅샷(표시용 라벨·번역만 — 원가 없음). */
    selectedOptions: ResolvedSelectedOption[];
    /** 티켓형(TICKET) 발행 이미지 URL — 게스트가 열람할 QR 티켓(발행된 것 자체가 산출물). */
    ticketUrls: string[];
    /** 티켓 이용자 스냅샷 원본 JSON — **RSC 전용**. page 매핑에서 ticketGuestDisplayNames로 이름만 추출해
     *  클라로 넘긴다. ★birthDate·heightCm는 여기까지만(클라 payload엔 이름만 — 소비자 표기 불필요). */
    ticketGuests: unknown;
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
      checkedOut: false,
      booking: null,
      amenities: [],
      minibar: [],
      catalog: [],
      fxVndPerKrw: null,
      agreement: emptyAgreement,
      requestedOrders: [],
    };
  }

  const booking = await prisma.booking.findUnique({
    where: { id: t.bookingId },
    select: {
      id: true,
      status: true, // 정산 내역 진입점 게이트(checkedOut 파생)
      villaId: true,
      checkIn: true,
      checkOut: true,
      nights: true,
      guestCount: true,
      breakfastIncluded: true,
      // 숙박 요금 노출 게이트용(직접 게스트만) + 금액
      seller: true,
      partnerId: true,
      saleCurrency: true,
      totalSaleVnd: true,
      totalSaleKrw: true,
      // ★ wifiSsid·wifiPassword·address는 게스트 체크인 화면 전용(출입정보 A1). /p엔 절대 미포함.
      villa: { select: { name: true, complex: true, hasPool: true, address: true, wifiSsid: true, wifiPassword: true } },
    },
  });
  if (!booking) return null;

  // 숙박 요금 게이트: 직접 게스트(운영자 판매·파트너 없음)만 노출. 파트너/공급자 예약은 미노출.
  const directGuest = booking.seller === "OPERATOR" && booking.partnerId == null;
  const stayChargeVnd =
    directGuest && booking.saleCurrency === "VND" && booking.totalSaleVnd != null
      ? booking.totalSaleVnd.toString()
      : null;
  const stayChargeKrw =
    directGuest && booking.saleCurrency === "KRW" ? booking.totalSaleKrw : null;

  const [amenityRows, minibarItems, villaStocks, catalogRows, orders, fxVndPerKrw] = await Promise.all([
    prisma.villaAmenity.findMany({
      where: { villaId: booking.villaId, category: { not: "MINIBAR" } },
      select: { category: true, itemKey: true, customLabel: true, customLabelKo: true },
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
    // ★ costVnd 미포함 — 게스트 비노출(판매가만 VND). KRW는 fxVndPerKrw로 표시 시점 파생.
    //   audiences 포함 — 게스트(GUEST) 자격 항목만 노출(과일 바구니=PARTNER 전용은 제외, ADR-0023 §9.2).
    prisma.serviceCatalogItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, type: true, nameKo: true, nameI18n: true,
        descKo: true, descI18n: true, unitLabelKo: true,
        priceVnd: true, photoUrl: true, options: true, audiences: true,
        pickupAvailable: true, pickupNote: true,
      },
    }),
    prisma.serviceOrder.findMany({
      where: { bookingId: t.bookingId, requestedVia: "GUEST" },
      orderBy: { createdAt: "desc" },
      // ★ 벤더는 name·phone만 select — bankInfo·costVnd·마진 절대 미포함(게스트 노출 화이트리스트).
      select: {
        id: true, type: true, catalogItemId: true, status: true, quantity: true,
        priceKrw: true, priceVnd: true, vendorStatus: true, poSentAt: true,
        serviceDate: true, serviceTime: true, selectedOptions: true,
        // 벤더 시간 제안(propose) — 게스트 승인/거절 UI용(ADR-0035). 판매가·원가 미포함.
        proposedServiceDate: true, proposedServiceTime: true,
        vendorProposalNote: true, vendorProposalRespondedAt: true,
        ticketUrls: true, // 티켓형(TICKET) 발행 이미지 — 게스트 열람 산출물(원가·마진 무관)
        ticketGuests: true, // 이용자 스냅샷({name,birthDate,heightCm}) — RSC 매핑에서 이름만 추출(라인 표기)
        vendor: { select: { name: true, phone: true } },
      },
    }),
    getFxVndPerKrw(prisma),
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
    checkedOut: booking.status === "CHECKED_OUT",
    booking: {
      villaName: booking.villa.name,
      complex: booking.villa.complex,
      checkIn: booking.checkIn.toISOString(),
      checkOut: booking.checkOut.toISOString(),
      nights: booking.nights,
      guestCount: booking.guestCount,
      breakfastIncluded: booking.breakfastIncluded,
      address: booking.villa.address,
      wifiSsid: booking.villa.wifiSsid,
      // ★와이파이 비번은 동의서 서명 후에만 서버가 직렬화 — 출입정보와 동일 정책.
      //   서명 직후 즉시 표시는 agreement POST 응답의 wifiPassword가 담당(리로드 불필요).
      wifiPassword: t.agreementSignedAt != null ? booking.villa.wifiPassword : null,
      stayChargeVnd,
      stayChargeKrw,
    },
    amenities: amenityRows,
    minibar,
    fxVndPerKrw,
    // 게스트 자격(GUEST) 항목만 — audiences에 GUEST 없는 항목(과일 바구니 등) 비노출(ADR-0023)
    catalog: catalogRows
      .filter((c) => parseAudiences(c.audiences).includes("GUEST"))
      .map((c) => ({
      id: c.id,
      type: c.type,
      nameKo: c.nameKo,
      nameI18n: c.nameI18n,
      descKo: c.descKo,
      descI18n: c.descI18n,
      unitLabelKo: c.unitLabelKo,
      priceVnd: c.priceVnd?.toString() ?? null,
      photoUrl: c.photoUrl,
      // ★옵션 원가는 게스트 절대 비노출 — costVnd 제거 후 전달(원칙2). costVnd select도 안 함.
      options: stripOptionCosts(c.options),
      pickupAvailable: c.pickupAvailable,
      pickupNote: c.pickupNote,
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
      catalogItemId: o.catalogItemId,
      status: o.status,
      quantity: o.quantity,
      priceKrw: o.priceKrw,
      priceVnd: o.priceVnd?.toString() ?? null,
      // 레거시 — PENDING_VENDOR·VENDOR_ACCEPTED. 취소 로직은 vendorAccepted로 판정(PENDING_VENDOR도 취소 가능).
      dispatched: o.vendorStatus === "PENDING_VENDOR" || o.vendorStatus === "VENDOR_ACCEPTED",
      // ★벤더 수락 여부 — true면 셀프 취소 불가·담당자 연락처 노출. 수락 후에만 이름·전화 게스트 노출.
      vendorAccepted: o.vendorStatus === "VENDOR_ACCEPTED",
      // ★연락처 게이트는 로더 계층에서 — 미수락 벤더 신원은 반환값 자체에 싣지 않는다(방어심층,
      //   새 소비자가 붙어도 누수 불가). 렌더 계층(orders/page)의 accepted 게이트와 동일 조건.
      vendorName:
        o.status === "CONFIRMED" || o.vendorStatus === "VENDOR_ACCEPTED" ? o.vendor?.name ?? null : null,
      vendorPhone:
        o.status === "CONFIRMED" || o.vendorStatus === "VENDOR_ACCEPTED" ? o.vendor?.phone ?? null : null,
      // 희망 날짜는 @db.Date(자정 UTC 저장) → YYYY-MM-DD. 시간은 "HH:MM" 문자열 그대로.
      serviceDate: o.serviceDate ? o.serviceDate.toISOString().slice(0, 10) : null,
      serviceTime: o.serviceTime ?? null,
      // 벤더 시간 제안(ADR-0035) — 제안값·메모·미해결 여부. @db.Date는 앞 10자리로 절단.
      proposedServiceDate: o.proposedServiceDate ? o.proposedServiceDate.toISOString().slice(0, 10) : null,
      proposedServiceTime: o.proposedServiceTime ?? null,
      vendorProposalNote: o.vendorProposalNote ?? null,
      proposalPending: o.proposedServiceDate != null && o.vendorProposalRespondedAt == null,
      // 선택 옵션은 라벨 스냅샷만(원가 없음 — ResolvedSelectedOption엔 costVnd 자체가 없음, 누수 0)
      selectedOptions: parseSelectedOptions(o.selectedOptions),
      // 발행된 티켓 이미지 — 상태 무관 노출(발행된 것 자체가 게스트 대상 산출물, ADR-0034)
      ticketUrls: o.ticketUrls,
      // 이용자 스냅샷 원본 — RSC 전용(page 매핑에서 이름만 추출). 클라 payload엔 이름만.
      ticketGuests: o.ticketGuests,
    })),
  };
}
