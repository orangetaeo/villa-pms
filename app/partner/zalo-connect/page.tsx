// /partner/zalo-connect — 파트너(여행사·랜드사) Zalo 알림 연결 온보딩.
//   공용 ZaloConnectScreen 재사용. role PARTNER 전용, 완료→/partner.
//   locale은 partner 포털 규칙(pref-locale > 계정 기본 > ko) 그대로 (layout·profile과 동일 우선순위).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { normalizeLocale, type AppLocale } from "@/lib/locale";
import { ZaloConnectScreen } from "@/components/zalo-connect/zalo-connect-screen";

export const metadata: Metadata = {
  title: "Zalo 알림 연결 — Villa Go",
};

// 파트너 포털 유효 locale: 사용자 선택(pref-locale) > 계정 기본(session) > ko 기본. (layout과 동일 우선순위)
async function getPartnerLocale(sessionLocale?: string | null): Promise<AppLocale> {
  const pref = (await cookies()).get("pref-locale")?.value;
  if (pref === "ko" || pref === "vi") return pref;
  return normalizeLocale(sessionLocale, "ko");
}

export default async function PartnerZaloConnectPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // 파트너 전용 — 타 역할은 로그인으로(레이아웃 가드와 동일 톤). 방어선.
  if (session.user.role !== "PARTNER") redirect("/login");

  const locale = await getPartnerLocale(session.user.locale);
  return <ZaloConnectScreen userId={session.user.id} locale={locale} doneHref="/partner" />;
}
