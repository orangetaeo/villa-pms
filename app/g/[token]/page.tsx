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
} from "@/lib/public-i18n";
import { AMENITY_CATEGORY_LABEL, amenityLabel, type SheetLang } from "@/lib/checkin-sheet-i18n";
import { GuestExpiredView } from "../_components/guest-expired-view";
import GuestFlow from "../_components/guest-flow";
import type {
  GuestAmenityGroup,
  GuestMinibarView,
} from "../_components/types";

export const metadata: Metadata = { title: "체크인 — Villa Go" };

// 어메니티 카테고리 표시 순서(미니바는 별도 섹션이라 제외)
const AMENITY_ORDER = ["KITCHEN", "BATHROOM", "APPLIANCE"];

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

  // ── G2 어메니티: 카테고리별로 묶고 라벨 해석 + 비치 수량(미니바 제외) ──
  const byCategory = new Map<string, { label: string; qty: number }[]>();
  for (const a of data.amenities) {
    if (!AMENITY_ORDER.includes(a.category)) continue;
    const label = amenityLabel(a.itemKey, sheetLang, a.customLabel, a.customLabelKo);
    const arr = byCategory.get(a.category) ?? [];
    arr.push({ label, qty: a.quantity });
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
        passportUploadedCount={data.passportUploadedCount}
        receiptHref={data.checkedOut ? `/g/${token}/receipt${lang === "ko" ? "" : `?lang=${lang}`}` : null}
      />
    </div>
  );
}
