// /g/[token]/options — 게스트 부가 옵션 신청 (비로그인 공개, ADR-0019 v2 게스트 UI 개편)
//
// ★ 누수 차단(원칙2): 게스트=한국 여행객. 자기 예약 하나만. 카탈로그는 판매가만(원가·마진 0).
//   게스트 가격은 ₫ 원천 단일 표기(다국적 커버). 카탈로그 이름·설명·옵션 라벨은 pickI18n로 언어 해석.
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
import { guestsFromPassportOcr } from "@/lib/ticket-guests";
import { GuestExpiredView } from "../../_components/guest-expired-view";
import GuestOptions from "../../_components/guest-options";
import type { GuestBookingView } from "../../_components/types";
import type { GuestCatalogView, GuestOption } from "../../_components/types";

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
    // TICKET 구분 자동판정 규칙(ADR-0036) — variant에만 존재. 공개정보(원가 아님).
    bornBeforeYear?: number | null;
    ageMin?: number | null;
    ageMax?: number | null;
    heightMaxCm?: number | null;
  }[],
  lang: PublicLang
): GuestOption[] {
  return defs.map((o) => ({
    key: o.key,
    label: pickI18n(o.labelKo, o.labelI18n ?? null, lang),
    priceVnd: o.priceVnd ?? null,
    desc: o.descKo ? pickI18n(o.descKo, o.descI18n ?? null, lang) : null,
    // 구분 규칙 패스스루(있을 때만 의미) — 게스트 폼이 이용자별 자동 판정에 사용
    bornBeforeYear: o.bornBeforeYear ?? null,
    ageMin: o.ageMin ?? null,
    ageMax: o.ageMax ?? null,
    heightMaxCm: o.heightMaxCm ?? null,
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
      pickupAvailable: c.pickupAvailable,
      pickupNote: c.pickupNote,
    };
  });

  // 예약 대표자 이름 — 이용자 이름 입력칸 기본값(prefill)용. 자기 예약이므로 누수 아님(원칙2 무관).
  const rep = await prisma.booking.findUnique({
    where: { id: data.bookingId },
    select: { guestName: true },
  });

  // 티켓 이용자 선택용 — 체크인된 투숙객 명단(이름·생년월일만). 자기 예약을 본인 토큰에 보여주는 것이라 누수 아님
  //   (여권번호 등은 guestsFromPassportOcr가 걸러 미전달). 체크인 전이면 빈 배열 → 폼은 기존 수량 입력 유지.
  const checkIn = await prisma.checkInRecord.findUnique({
    where: { bookingId: data.bookingId },
    select: { passportOcrJson: true },
  });
  const checkedInGuests = guestsFromPassportOcr(checkIn?.passportOcrJson);

  // 요청 내역은 별도 페이지(/g/[token]/orders)에서 표시 — 여기서는 신청 폼만.
  // ★출입 정보(주소·wifi)는 옵션 화면에 불필요 → null로 전달(이 페이지 payload에 wifi 미포함).
  const booking: GuestBookingView = {
    villaName: data.booking.villaName,
    guestName: rep?.guestName ?? null,
    complex: data.booking.complex,
    checkIn: data.booking.checkIn,
    checkOut: data.booking.checkOut,
    nights: data.booking.nights,
    guestCount: data.booking.guestCount,
    breakfastIncluded: data.booking.breakfastIncluded,
    address: null,
    wifiSsid: null,
    wifiPassword: null,
    // 옵션 화면엔 숙박 요금 미표기(요금은 홈 요약에서) — null 전달
    stayChargeVnd: null,
    stayChargeKrw: null,
  };

  // 금액은 ₫ 원천 단일 표기(다국적 커버) — 모국통화 환산 보조 표기 제거(2026-07-13, 테오 지시).

  return (
    <div className="bg-slate-50 text-slate-900 antialiased">
      <GuestOptions
        token={token}
        lang={lang}
        booking={booking}
        catalog={catalog}
        checkedInGuests={checkedInGuests}
      />
    </div>
  );
}
