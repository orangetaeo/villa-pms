// lib/partner-addon-load.ts — /p/[token]/done 파트너 부가서비스 요청 데이터 로더 (ADR-0023 S4)
//
// ★ 누수 차단(원칙2 — 재고·마진 비공개): 파트너(여행사/랜드사, /p 비로그인)는 자기 제안의 이 예약 하나만.
//   카탈로그는 **판매가만** 노출(판매가=priceVnd, 표시는 proposal.saleCurrency 기준 KRW 또는 VND).
//   costVnd(원가)·vendorId(원천 공급자 신원)·마진은 select 화이트리스트에서 제외 — 클라로 절대 직렬화하지 않는다.
//   audiences ∋ PARTNER 인 활성 항목만(과일 바구니·도시락 등). GUEST 전용은 노출하지 않는다(서버 필터).
import { prisma } from "./prisma";
import { parseAudiences, parseCatalogOptions } from "./service-catalog";
import { pickI18n } from "./service-display";
import { getFxVndPerKrw } from "./pricing";
import type { Currency } from "@prisma/client";
import type { PublicLang } from "./public-i18n";

/** 파트너 카탈로그 옵션 1개(언어 해석 완료). 가격은 VND 문자열(KRW는 표시 시점 fx 파생). */
export interface PartnerOption {
  key: string;
  label: string;
  priceVnd: string | null;
}

/** 파트너 카탈로그 카드 1개 — 판매가만(원가·vendorId 없음). */
export interface PartnerCatalogView {
  id: string;
  type: string;
  name: string;
  desc: string | null;
  unitLabel: string | null;
  priceVnd: string | null;
  photoUrl: string | null;
  variants: PartnerOption[];
  addons: PartnerOption[];
  modifiers: PartnerOption[];
}

/** 이 예약에 이미 들어온 파트너 요청 1건(요청 내역 표시용) — 판매가만. */
export interface PartnerRequestedOrder {
  id: string;
  type: string;
  name: string;
  status: string;
  quantity: number;
  priceKrw: number | null;
  priceVnd: string | null;
}

export interface PartnerAddonData {
  saleCurrency: Currency;
  /** 현재 환율(1 KRW당 VND, 문자열). 미설정이면 null → KRW 채널은 "가격 문의". */
  fxVndPerKrw: string | null;
  catalog: PartnerCatalogView[];
  requestedOrders: PartnerRequestedOrder[];
}

function mapOptions(
  defs: { key: string; labelKo: string; labelI18n?: unknown; priceVnd?: string | null }[],
  lang: PublicLang
): PartnerOption[] {
  return defs.map((o) => ({
    key: o.key,
    label: pickI18n(o.labelKo, o.labelI18n ?? null, lang),
    priceVnd: o.priceVnd ?? null,
  }));
}

/**
 * 파트너 부가서비스 데이터 로드 — 이미 token→booking 스코프가 검증된 done 페이지에서 호출.
 *   bookingId·saleCurrency는 done 페이지가 검증/조회한 값을 그대로 넘겨받는다(중복 조회 회피).
 *   카탈로그는 PARTNER 자격·활성만, costVnd·vendorId 미select(판매가만).
 */
export async function loadPartnerAddon(
  bookingId: string,
  saleCurrency: Currency,
  lang: PublicLang,
  /** 직판(DIRECT) 예약이면 true — 소비자 본인 신청(GUEST 저장, consumer-bugs #2)도 함께 표시 */
  includeGuestOrders = false
): Promise<PartnerAddonData> {
  const [catalogRows, orders, fxVndPerKrw] = await Promise.all([
    // ★ costVnd·vendorId 미포함 — 파트너 비노출(판매가·표시용 필드만). audiences로 채널 서버 필터.
    prisma.serviceCatalogItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, type: true, nameKo: true, nameI18n: true,
        descKo: true, descI18n: true, unitLabelKo: true,
        priceVnd: true, photoUrl: true, options: true, audiences: true,
      },
    }),
    prisma.serviceOrder.findMany({
      where: {
        bookingId,
        requestedVia: includeGuestOrders ? { in: ["PARTNER", "GUEST"] } : "PARTNER",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, status: true, quantity: true, priceKrw: true, priceVnd: true },
    }),
    getFxVndPerKrw(prisma),
  ]);

  // PARTNER 자격 항목만(과일 바구니·도시락 등) — audiences에 PARTNER 없는 항목은 서버에서 제외.
  const catalog: PartnerCatalogView[] = catalogRows
    .filter((c) => parseAudiences(c.audiences).includes("PARTNER"))
    .map((c) => {
      const opts = parseCatalogOptions(c.options);
      return {
        id: c.id,
        type: c.type,
        name: pickI18n(c.nameKo, c.nameI18n, lang),
        desc: c.descKo ? pickI18n(c.descKo, c.descI18n, lang) : null,
        unitLabel: c.unitLabelKo,
        priceVnd: c.priceVnd?.toString() ?? null,
        photoUrl: c.photoUrl,
        variants: mapOptions(opts.variants ?? [], lang),
        addons: mapOptions(opts.addons ?? [], lang),
        modifiers: mapOptions(opts.modifiers ?? [], lang),
      };
    });

  const catalogNameByType = new Map(catalog.map((c) => [c.type, c.name]));
  const requestedOrders: PartnerRequestedOrder[] = orders.map((o) => ({
    id: o.id,
    type: o.type,
    name: catalogNameByType.get(o.type) ?? o.type,
    status: o.status,
    quantity: o.quantity,
    priceKrw: o.priceKrw,
    priceVnd: o.priceVnd?.toString() ?? null,
  }));

  return { saleCurrency, fxVndPerKrw, catalog, requestedOrders };
}
