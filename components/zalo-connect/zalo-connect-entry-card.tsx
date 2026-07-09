// Zalo 알림 연결 진입 카드 (RSC) — 라이트 포털 계정(profile) 화면의 extra 슬롯에 재사용.
//   연결 여부(zaloUserId)에 따라 상태 문구·색을 바꾸고, 각 포털의 zalo-connect 라우트로 링크.
//   문구는 zaloConnect NS(profile* 키) — 서버 번역이라 클라 화이트리스트 무관.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/lib/locale";

export async function ZaloConnectEntryCard({
  locale,
  connected,
  href,
}: {
  locale: AppLocale;
  connected: boolean;
  /** 각 포털 zalo-connect 경로 — 공급자=/zalo-connect·벤더=/vendor/zalo-connect·파트너=/partner/zalo-connect */
  href: string;
}) {
  const tz = await getTranslations({ locale, namespace: "zaloConnect" });
  return (
    <Link
      href={href}
      className="mt-6 flex items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm transition-transform active:scale-[0.99]"
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
          connected ? "bg-green-50 text-green-600" : "bg-teal-50 text-teal-600"
        }`}
      >
        <span className="material-symbols-outlined">forum</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-neutral-900">{tz("profileCardTitle")}</span>
        <span className="block text-sm text-neutral-500">
          {connected ? tz("profileConnected") : tz("profileNotConnected")}
        </span>
      </span>
      <span className="material-symbols-outlined shrink-0 text-neutral-400">chevron_right</span>
    </Link>
  );
}
