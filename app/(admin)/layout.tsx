import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import AdminSidebar from "@/components/admin/sidebar";
import { pickMessages } from "@/lib/intl-messages";
import { prisma } from "@/lib/prisma";

// [QA D-2b] 루트 layout이 전체 messages 직렬화를 중단함에 따라
// admin 클라이언트 컴포넌트용 메시지는 여기서 화이트리스트로 공급.
// 전수 grep 근거 (useTranslations 사용 클라이언트 컴포넌트 → 최상위 네임스페이스):
//   components/admin/sidebar                         → nav
//   bookings/filters-bar, [id]/action-panel·memo-box → adminBookings
//   bookings/[id]/checkin/checkin-form               → adminCheckin
//   bookings/[id]/checkout/checkout-form             → adminCheckout, amenities(.items)
//   villas/[id]/villa-actions·rate-editor            → adminVillas
//   users/users-manager                              → adminUsers
//   settlements/settlements-view                     → adminSettlements
//   settings/hold-hours-form·season-manager·fx-rate-form → adminSettings
//   proposals/proposals-list, new/proposal-create    → adminProposals
//   inspections/inspections-view                     → adminInspections
//   settings/zalo/zalo-connect-client                → adminZalo
// 새 admin 클라이언트 컴포넌트에서 네임스페이스 추가 시 반드시 여기에도 추가할 것
// (누락 시 MISSING_MESSAGE로 화면 깨짐).
const ADMIN_CLIENT_NAMESPACES = [
  "nav",
  "adminBookings",
  "adminCheckin",
  "adminCheckout",
  "adminVillas",
  "adminUsers",
  "adminSettlements",
  "adminSettings",
  "adminProposals",
  "adminInspections",
  "adminMessages",
  "adminZalo",
  "amenities",
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session || session.user?.role !== "ADMIN") {
    redirect("/login");
  }

  // i18n/request.ts(cookie locale, 기본 ko)와 동일한 locale로 서버/클라이언트 일치 유지
  const locale = await getLocale();
  const allMessages = (await import(`../../messages/${locale}.json`)).default;
  const messages = pickMessages(allMessages, ADMIN_CLIENT_NAMESPACES);

  // 사이드바 메시지 메뉴 미읽음 합계 뱃지 (T6.6, b14)
  // ADR-0007 개인 스코프: 본인(ownerAdminId) 대화만 합산 — 타 관리자 미읽음 누수 차단.
  const unreadAgg = await prisma.zaloConversation.aggregate({
    where: { ownerAdminId: session.user.id },
    _sum: { unreadCount: true },
  });
  const unreadCount = unreadAgg._sum.unreadCount ?? 0;

  // 로그아웃 서버 액션 — 사이드바(클라이언트)에 전달. 완료 후 /login
  async function logoutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="min-h-screen bg-admin-bg text-slate-50 font-admin">
      <NextIntlClientProvider locale={locale} messages={messages}>
      <AdminSidebar
        userName={session.user.name}
        unreadCount={unreadCount}
        logoutAction={logoutAction}
      />
      {/* 데스크톱: 사이드바 폭만큼 밀기 / 모바일: 헤더 높이만큼 내리기 */}
      <main className="lg:pl-64 pt-14 lg:pt-0 min-h-screen">
        <div className="p-4 md:p-8">{children}</div>
      </main>
      </NextIntlClientProvider>
    </div>
  );
}
