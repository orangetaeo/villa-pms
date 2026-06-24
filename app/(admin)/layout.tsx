import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import AdminSidebar from "@/components/admin/sidebar";
import MobileNavSpacer from "@/components/admin/mobile-nav-spacer";
import { pickMessages } from "@/lib/intl-messages";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";

// [QA D-2b] 루트 layout이 전체 messages 직렬화를 중단함에 따라
// admin 클라이언트 컴포넌트용 메시지는 여기서 화이트리스트로 공급.
// 전수 grep 근거 (useTranslations 사용 클라이언트 컴포넌트 → 최상위 네임스페이스):
//   components/admin/sidebar                         → nav
//   bookings/filters-bar, [id]/action-panel·memo-box → adminBookings
//   bookings/[id]/checkin/checkin-form               → adminCheckin
//   bookings/[id]/checkout/checkout-form             → adminCheckout, amenities(.items)
//   villas/[id]/villa-actions·rate-editor            → adminVillas
//   villas/[id]/sales-editor·detail-tabs             → adminVillas(.sales), bedding, features
//   users/users-manager                              → adminUsers
//   settlements/settlements-view                     → adminSettlements
//   settings/hold-hours-form·season-manager·fx-rate-form → adminSettings
//   proposals/proposals-list, new/proposal-create    → adminProposals
//   inspections/inspections-view                     → adminInspections
//   settings/zalo/zalo-connect-client                → adminZalo
//   cost-alerts/cost-alerts-view                     → adminCostAlerts
//   components/admin/quick-date-filter               → quickDateFilter
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
  "adminCostAlerts",
  "amenities",
  "quickDateFilter",
  // 리스트 공통 페이지네이션 바(components/pagination-bar) — 전 목록 페이지 공용
  "pagination",
  // 판매정보 입력 폼(sales-editor·detail-tabs) — ADR-0011
  "bedding",
  "features",
  // 본인 비밀번호 변경 폼(/account) — change-password-form
  "account",
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // S-RBAC-3: 운영자 전체(OWNER/MANAGER/STAFF/ADMIN) 진입 허용. 재무 마스킹은 각 화면 책임.
  if (!session?.user?.id || !isOperator(session.user.role)) {
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
    <div className="min-h-dvh bg-admin-bg text-slate-50 font-admin">
      <NextIntlClientProvider locale={locale} messages={messages}>
      <AdminSidebar
        userName={session.user.name}
        role={session.user.role}
        unreadCount={unreadCount}
        logoutAction={logoutAction}
        currentLocale={locale === "vi" ? "vi" : "ko"}
      />
      {/* 데스크톱: 사이드바 폭만큼 밀기 / 모바일: 헤더 높이만큼 내리기 */}
      <main className="lg:pl-64 pt-14 lg:pt-0 min-h-dvh">
        <div className="p-4 md:p-8">{children}</div>
        {/* 모바일 하단 네비에 콘텐츠가 가리지 않도록 인-플로우 스페이서 (풀스크린 라우트는 자동 0) */}
        <MobileNavSpacer />
      </main>
      </NextIntlClientProvider>
    </div>
  );
}
