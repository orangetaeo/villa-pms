// /profile — 공급자·청소(CLEANER) 본인 계정(비밀번호 변경 + 로그아웃). vi 기본, 모바일 라이트.
//   (supplier) layout이 로그인 보장. 공용 AccountScreen 셸 사용(VENDOR/PARTNER와 동일 구조).
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
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

  // Zalo 연결 여부 — 알림 수신 진입점(연결 카드)에서 상태 표시
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { zaloUserId: true },
  });
  const zaloConnected = Boolean(me?.zaloUserId);
  const tz = await getTranslations({ locale, namespace: "zaloConnect" });

  // 뒤로 — 역할별 홈으로 라우팅하는 루트("/")로(공급자=/my-villas·청소자=/cleaning 등).
  // /my-villas 고정 시 CLEANER가 /login 루프에 빠지므로 루트 분기 사용.
  return (
    <AccountScreen
      locale={locale}
      loggedInName={session.user.name ?? ""}
      backHref="/"
      // Zalo 알림 연결 진입점 — 새 배정·청소 요청 알림 수신용(공급자·청소직원 공용).
      extra={
        <Link
          href="/zalo-connect"
          className="mt-6 flex items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm transition-transform active:scale-[0.99]"
        >
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
              zaloConnected ? "bg-green-50 text-green-600" : "bg-teal-50 text-teal-600"
            }`}
          >
            <span className="material-symbols-outlined">forum</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-neutral-900">{tz("profileCardTitle")}</span>
            <span className="block text-sm text-neutral-500">
              {zaloConnected ? tz("profileConnected") : tz("profileNotConnected")}
            </span>
          </span>
          <span className="material-symbols-outlined shrink-0 text-neutral-400">chevron_right</span>
        </Link>
      }
    />
  );
}
