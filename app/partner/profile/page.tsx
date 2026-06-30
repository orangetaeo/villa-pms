// /partner/profile — 파트너(여행사·랜드사) 본인 계정(비밀번호 변경 + 로그아웃).
//   공용 AccountScreen 셸 사용(SUPPLIER/VENDOR와 동일 구조). 기본 ko(한국 여행사·랜드사 다수).
//   partner layout이 PARTNER 역할·승인(APPROVED)을 보장 — 승인된 파트너의 인포털 계정 화면.
//   (미승인 파트너의 임시비번 변경은 승인대기 화면이 공유 /profile로 우회 — partner gate 바이패스)
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { normalizeLocale, type AppLocale } from "@/lib/locale";
import AccountScreen from "@/components/account/account-screen";

export const metadata: Metadata = {
  title: "내 계정 — Villa Go",
};

// 파트너 포털 유효 locale: 사용자 선택(pref-locale) > 계정 기본(session) > ko 기본. (layout과 동일 우선순위)
async function getPartnerLocale(sessionLocale?: string | null): Promise<AppLocale> {
  const pref = (await cookies()).get("pref-locale")?.value;
  if (pref === "ko" || pref === "vi") return pref;
  return normalizeLocale(sessionLocale, "ko");
}

export default async function PartnerAccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARTNER") redirect("/login");

  const locale = await getPartnerLocale(session.user.locale);

  return (
    <AccountScreen
      locale={locale}
      loggedInName={session.user.name ?? ""}
      backHref="/partner"
      // 파트너 layout main이 자체 px-4 py-6 + 탭바 pb 처리 → 외부 패딩 최소화(헤더 sticky라 top 여백 불필요).
      containerClassName="w-full pb-8"
    />
  );
}
