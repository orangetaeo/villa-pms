// /g/[token]/orders — 게스트 신청 내역 (비로그인 공개, 부가 옵션 신청과 분리)
//
// ★ 누수 차단(원칙2): 게스트=한국 여행객. 자기 예약의 요청 옵션만. 판매가(VND)·상태만 — 원가·마진 0.
//   옵션 라벨은 selectedOptions 스냅샷에서 pickI18n로 언어 해석(같은 서비스의 다른 옵션 구분).
//   토큰 없음=404. 만료·회수=안내 화면. 언어: ?lang= > p-locale 쿠키 > ko.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { loadGuestCheckin } from "@/lib/guest-checkin-load";
import { PUBLIC_LOCALE_COOKIE, resolvePublicLang } from "@/lib/public-i18n";
import { pickI18n } from "@/lib/service-display";
import { GUEST_LABELS } from "@/lib/guest-i18n";
import { fulfillmentNote } from "@/lib/guest-fulfillment";
import { GuestExpiredView } from "../../_components/guest-expired-view";
import GuestOrders from "../../_components/guest-orders";
import type { GuestRequestedOrder } from "../../_components/types";

export const metadata: Metadata = { title: "신청 내역 — Villa Go" };

async function getContactSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["CONTACT_KAKAO_URL", "CONTACT_PHONE"] } },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { kakaoUrl: get("CONTACT_KAKAO_URL"), phone: get("CONTACT_PHONE") };
}

export default async function GuestOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string; ordered?: string }>;
}) {
  const { token } = await params;
  const { lang: langParam, ordered } = await searchParams;
  const justOrdered = ordered === "1";
  const cookieLang = (await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value;
  const lang = resolvePublicLang(langParam, cookieLang);

  const data = await loadGuestCheckin(token);
  if (!data) notFound();

  if (data.state !== "OK" || !data.booking) {
    const contact = await getContactSettings();
    return <GuestExpiredView lang={lang} kakaoUrl={contact.kakaoUrl} phone={contact.phone} />;
  }

  // 카탈로그명은 type 폴백용(주문엔 type만 매칭). 옵션 상세는 selectedOptions 스냅샷에서 해석.
  const catalogNameByType = new Map(
    data.catalog.map((c) => [c.type, pickI18n(c.nameKo, c.nameI18n, lang)])
  );
  // 픽업/이행 안내 해석용 — catalogItemId → {pickupAvailable, pickupNote}
  const pickupById = new Map(
    data.catalog.map((c) => [c.id, { pickupAvailable: c.pickupAvailable, pickupNote: c.pickupNote }])
  );
  const La = GUEST_LABELS[lang].addons;
  const requestedOrders: GuestRequestedOrder[] = data.requestedOrders.map((o) => {
    const pu = o.catalogItemId ? pickupById.get(o.catalogItemId) : null;
    // ★담당자 연락처는 확정(CONFIRMED)·벤더 수락 후에만 게스트 노출 — 그 전엔 payload에도 미포함.
    const accepted = o.status === "CONFIRMED" || o.vendorAccepted;
    return {
      id: o.id,
      type: o.type,
      name: catalogNameByType.get(o.type) ?? o.type,
      status: o.status,
      quantity: o.quantity,
      priceKrw: o.priceKrw,
      priceVnd: o.priceVnd,
      dispatched: o.dispatched,
      vendorAccepted: o.vendorAccepted,
      vendorName: accepted ? o.vendorName : null,
      vendorPhone: accepted ? o.vendorPhone : null,
      optionLabels: o.selectedOptions.map((s) => pickI18n(s.labelKo, s.labelI18n ?? null, lang)),
      serviceDate: o.serviceDate,
      serviceTime: o.serviceTime,
      fulfillNote: fulfillmentNote(o.type, pu?.pickupAvailable ?? null, pu?.pickupNote ?? null, La),
    };
  });

  return (
    <div className="bg-slate-50 text-slate-900 antialiased">
      <GuestOrders token={token} lang={lang} requestedOrders={requestedOrders} justOrdered={justOrdered} />
    </div>
  );
}
