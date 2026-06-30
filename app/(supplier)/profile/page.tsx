// /profile — 공급자·청소(CLEANER) 본인 계정(비밀번호 변경 + 로그아웃). vi 기본, 모바일 라이트.
//   (supplier) layout이 로그인 보장. 공용 AccountScreen 셸 사용(VENDOR/PARTNER와 동일 구조).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getSupplierLocale } from "@/lib/locale";
import AccountScreen from "@/components/account/account-screen";

export const metadata: Metadata = {
  title: "Tài khoản",
};

export default async function SupplierAccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // 청소직원은 베트남어 고정(한국어 미노출). 공급자는 기존 우선순위.
  const locale =
    session.user.role === "CLEANER" ? "vi" : await getSupplierLocale(session.user.locale);

  // 뒤로 — 역할별 홈으로 라우팅하는 루트("/")로(공급자=/my-villas·청소자=/cleaning 등).
  // /my-villas 고정 시 CLEANER가 /login 루프에 빠지므로 루트 분기 사용.
  return (
    <AccountScreen
      locale={locale}
      loggedInName={session.user.name ?? ""}
      backHref="/"
    />
  );
}
