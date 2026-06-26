// /g/[token]/options — 게스트 부가 옵션 신청 (비로그인 공개, ADR-0019 v2 게스트 UI 개편)
//
// ★ 누수 차단(원칙2): 게스트=한국 여행객. 자기 예약 하나만. 카탈로그는 판매가만(원가·마진 0).
//   게스트 가격은 KRW만(priceKrwCeil). 카탈로그 이름·설명·옵션 라벨은 pickI18n로 언어 해석.
//   토큰 없음=404. 만료·회수=안내 화면. 언어: ?lang= > p-locale 쿠키 > ko.
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
import { pickI18n } from "@/lib/service-display";
import { GuestExpiredView } from "../../_components/guest-expired-view";
import GuestOptions from "../../_components/guest-options";
import type { GuestCatalogView, GuestOption, GuestRequestedOrder } from "../../_components/types";

export const metadata: Metadata = { title: "부가 옵션 — Villa Go" };

/** 카탈로그 옵션 1그룹 → 언어 해석된 GuestOption[] (라벨·설명은 i18n에서 pickI18n, VND만 — 원가 미포함=누수 0). */
function mapOptions(
  defs: {
    key: string;
    labelKo: string;
    labelI18n?: unknown;
    priceVnd?: string | null;
    descKo?: string | null;
    descI18n?: unknown;
  }[],
  lang: PublicLang
): GuestOption[] {
  return defs.map((o) => ({
    key: o.key,
    label: pickI18n(o.labelKo, o.labelI18n ?? null, lang),
    priceVnd: o.priceVnd ?? null,
    desc: o.descKo ? pickI18n(o.descKo, o.descI18n ?? null, lang) : null,
  }));
}

async function getContactSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["CONTACT_KAKAO_URL", "CONTACT_PHONE"] } },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { kakaoUrl: get("CONTACT_KAKAO_URL"), phone: get("CONTACT_PHONE") };
}

export default async function GuestOptionsPage({
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

  // ── 카탈로그: 옵션 파싱 + 언어 해석(판매가 VND만 — KRW는 클라가 fx로 파생) ──
  const catalog: GuestCatalogView[] = data.catalog.map((c) => {
    const opts = parseCatalogOptions(c.options);
    return {
      id: c.id,
      type: c.type,
      name: pickI18n(c.nameKo, c.nameI18n, lang),
      desc: c.descKo ? pickI18n(c.descKo, c.descI18n, lang) : null,
      unitLabel: c.unitLabelKo, // 단위 라벨은 ko만 보유
      priceVnd: c.priceVnd,
      photoUrl: c.photoUrl,
      variants: mapOptions(opts.variants ?? [], lang),
      addons: mapOptions(opts.addons ?? [], lang),
      modifiers: mapOptions(opts.modifiers ?? [], lang),
    };
  });

  // ── 기존 요청 내역 (카탈로그명 폴백 — 주문엔 type만 매칭) ──
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

  const booking = {
    villaName: data.booking.villaName,
    complex: data.booking.complex,
    checkIn: data.booking.checkIn,
    checkOut: data.booking.checkOut,
    nights: data.booking.nights,
    guestCount: data.booking.guestCount,
    breakfastIncluded: data.booking.breakfastIncluded,
  };

  return (
    <div className="bg-slate-50 text-slate-900 antialiased">
      <GuestOptions
        token={token}
        lang={lang}
        booking={booking}
        catalog={catalog}
        requestedOrders={requestedOrders}
        fxVndPerKrw={data.fxVndPerKrw}
      />
    </div>
  );
}
