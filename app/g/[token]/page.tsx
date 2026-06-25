// /g/[token] — 게스트 셀프 체크인 (비로그인 공개, ADR-0019 S3, design g1~g5 변환)
//
// ★ 누수 차단(원칙2): 게스트=한국 여행객. 자기 예약 하나만. 원가·마진·환산·타예약·전체재고 0.
//   로더(lib/guest-checkin-load)가 판매가만 직렬화 — 이 페이지는 lang 라벨 해석 후 클라에 주입.
//   토큰 없음=404(notFound). 만료·회수=안내 화면(c2 톤). 언어: ?lang= > p-locale 쿠키 > ko.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { loadGuestCheckin } from "@/lib/guest-checkin-load";
import {
  PUBLIC_LOCALE_COOKIE,
  resolvePublicLang,
  type PublicLang,
} from "@/lib/public-i18n";
import { parseCatalogOptions } from "@/lib/service-catalog";
import { AMENITY_CATEGORY_LABEL, amenityLabel, type SheetLang } from "@/lib/checkin-sheet-i18n";
import { GuestExpiredView } from "../_components/guest-expired-view";
import GuestFlow from "../_components/guest-flow";
import type {
  GuestAmenityGroup,
  GuestCatalogView,
  GuestMinibarView,
  GuestOption,
  GuestRequestedOrder,
} from "../_components/types";

export const metadata: Metadata = { title: "체크인 — Villa Go" };

// 어메니티 카테고리 표시 순서(미니바는 별도 섹션이라 제외)
const AMENITY_ORDER = ["KITCHEN", "BATHROOM", "APPLIANCE"];

/** 카탈로그 옵션 1그룹 → 언어 해석된 GuestOption[] (라벨 ko/vi 폴백, KRW/VND 그대로). */
function mapOptions(
  defs: { key: string; labelKo: string; labelVi?: string | null; priceKrw?: number | null; priceVnd?: string | null }[],
  lang: PublicLang
): GuestOption[] {
  return defs.map((o) => ({
    key: o.key,
    // 옵션 라벨은 ko/vi만 보유 — vi 선택 시 labelVi, 그 외(en/zh/ru)는 ko 폴백
    label: lang === "vi" && o.labelVi ? o.labelVi : o.labelKo,
    priceKrw: o.priceKrw ?? null,
    priceVnd: o.priceVnd ?? null,
  }));
}

/** 카탈로그명/설명 언어 해석 — nameEn은 en/zh/ru 폴백, vi는 nameVi, 기본 ko. */
function pickName(
  c: { nameKo: string; nameVi: string | null; nameEn: string | null },
  lang: PublicLang
): string {
  if (lang === "vi" && c.nameVi) return c.nameVi;
  if ((lang === "en" || lang === "zh" || lang === "ru") && c.nameEn) return c.nameEn;
  return c.nameKo;
}

function pickDesc(
  c: { descKo: string | null; descVi: string | null },
  lang: PublicLang
): string | null {
  if (lang === "vi" && c.descVi) return c.descVi;
  return c.descKo;
}

async function getContactSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["CONTACT_KAKAO_URL", "CONTACT_PHONE"] } },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { kakaoUrl: get("CONTACT_KAKAO_URL"), phone: get("CONTACT_PHONE") };
}

export default async function GuestCheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token } = await params;
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  const lang = resolvePublicLang(langParam, cookieLang);

  const data = await loadGuestCheckin(token);
  if (!data) notFound();

  if (data.state !== "OK" || !data.booking) {
    const contact = await getContactSettings();
    return <GuestExpiredView lang={lang} kakaoUrl={contact.kakaoUrl} phone={contact.phone} />;
  }

  const sheetLang = lang as SheetLang; // PublicLang ⊆ SheetLang (ko/vi/en/zh/ru 동일)

  // ── G2 어메니티: 카테고리별로 묶고 라벨 해석(미니바 제외) ──
  const byCategory = new Map<string, string[]>();
  for (const a of data.amenities) {
    if (!AMENITY_ORDER.includes(a.category)) continue;
    const label = amenityLabel(a.itemKey, sheetLang, a.customLabel);
    const arr = byCategory.get(a.category) ?? [];
    arr.push(label);
    byCategory.set(a.category, arr);
  }
  const amenityGroups: GuestAmenityGroup[] = AMENITY_ORDER.filter((c) => byCategory.has(c)).map(
    (category) => ({
      category,
      label: AMENITY_CATEGORY_LABEL[category]?.[sheetLang] ?? category,
      items: byCategory.get(category) ?? [],
    })
  );

  // ── G2 미니바: 이름 ko/vi 폴백(다른 언어는 ko) ──
  const minibar: GuestMinibarView[] = data.minibar.map((m) => ({
    itemKey: m.itemKey,
    name: lang === "vi" && m.nameVi ? m.nameVi : m.nameKo,
    qty: m.qty,
    priceVnd: m.priceVnd,
  }));

  // ── G4 카탈로그: 옵션 파싱 + 언어 해석 ──
  const catalog: GuestCatalogView[] = data.catalog.map((c) => {
    const opts = parseCatalogOptions(c.options);
    return {
      id: c.id,
      type: c.type,
      name: pickName(c, lang),
      desc: pickDesc(c, lang),
      unitLabel: c.unitLabelKo, // 단위 라벨은 ko만 보유 — 모든 언어 ko 표기
      priceKrw: c.priceKrw,
      priceVnd: c.priceVnd,
      photoUrl: c.photoUrl,
      variants: mapOptions(opts.variants ?? [], lang),
      addons: mapOptions(opts.addons ?? [], lang),
      modifiers: mapOptions(opts.modifiers ?? [], lang),
    };
  });

  // ── G5 기존 요청 내역 ── (카탈로그명 폴백 — 주문엔 type만, 카탈로그에서 매칭 불가하면 type)
  const catalogNameByType = new Map(catalog.map((c) => [c.type, c.name]));
  const requestedOrders: GuestRequestedOrder[] = data.requestedOrders.map((o) => ({
    id: o.id,
    type: o.type,
    name: catalogNameByType.get(o.type) ?? o.type,
    status: o.status,
    quantity: o.quantity,
    priceKrw: o.priceKrw,
    priceVnd: o.priceVnd,
  }));

  // ── G3 동의서 본문 언어 해석 ──
  const agreement = {
    version: data.agreement.version,
    docTitle: data.agreement.docTitle[sheetLang] ?? data.agreement.docTitle.ko,
    clauses: data.agreement.clauses.map((c) => ({
      key: c.key,
      content: c.content[sheetLang] ?? c.content.ko,
    })),
  };

  return (
    <div className="bg-slate-50 text-slate-900 antialiased">
      <GuestFlow
        token={token}
        lang={lang}
        alreadySigned={data.alreadySigned}
        signedVersion={data.alreadySigned ? data.agreement.version : null}
        booking={data.booking}
        amenityGroups={amenityGroups}
        minibar={minibar}
        agreement={agreement}
        catalog={catalog}
        requestedOrders={requestedOrders}
      />
    </div>
  );
}
