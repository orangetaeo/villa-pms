import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import AdminSidebar from "@/components/admin/sidebar";
import { TourHelpButton } from "@/components/tour/coach-mark";
import MobileNavSpacer, { ADMIN_FULLSCREEN_PREFIXES } from "@/components/admin/mobile-nav-spacer";
import PullToRefresh from "@/components/pull-to-refresh";
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
//   settings/hold-hours-form·season-manager·fx-rate-form·agreement-form → adminSettings
//   inventory/inventory-tabs·minibar-manager         → inventory, adminMinibar
//   proposals/proposals-list, new/proposal-create    → adminProposals
//   inspections/inspections-view                     → adminInspections
//   settings/zalo/zalo-connect-client                → adminZalo
//   cost-alerts/cost-alerts-view                     → adminCostAlerts
//   components/admin/quick-date-filter               → quickDateFilter
//   revenue/revenue-client                           → revenue (매출관리)
//   settings/vendors/vendors-manager                 → adminVendors (부가서비스 공급자, ADR-0023)
// (완성도는 tests/admin-i18n-whitelist.test.ts가 자동 검증 — 누락 시 라벨 raw 키로 깨짐)
// 새 admin 클라이언트 컴포넌트에서 네임스페이스 추가 시 반드시 여기에도 추가할 것
// (누락 시 MISSING_MESSAGE로 화면 깨짐).
const ADMIN_CLIENT_NAMESPACES = [
  "nav",
  // 통화 단위 공용 키(currency.krwUnit — ko "원" / vi "₩") — 금액 접미사 리터럴 키화(LOC)
  "currency",
  "adminStatistics",
  "adminBookings",
  "adminCheckin",
  "adminCheckout",
  "adminVillas",
  "adminUsers",
  "adminSettlements",
  // 파트너 관리(ADR-0022 PARTNER-2) — partners-manager·partner-form·partner-detail
  "adminPartners",
  "adminSettings",
  "adminMinibar",
  // ADR-0019 — 미니바 실재고·부가서비스 카탈로그/주문·게스트 토큰 (클라이언트 컴포넌트 네임스페이스)
  "inventory",
  "adminServices",
  "adminServiceOrders",
  // 부가서비스 원천 공급자 관리(ADR-0023) /settings/vendors(vendors-manager) — 화이트리스트
  // 누락으로 라벨이 raw 키로 깨지던 버그 수정(2026-06-27, revenue와 동일 클래스).
  "adminVendors",
  "adminGuestToken",
  "adminProposals",
  "adminInspections",
  // 매출관리 /revenue(revenue-client) — PR #74에서 페이지·메시지는 추가됐으나 이 화이트리스트
  // 누락으로 클라이언트 라벨이 raw 키로 깨지던 버그 수정(2026-06-27).
  "revenue",
  "adminMessages",
  // 웹 채팅 인박스 탭(/messages?tab=webchat) — source-tabs·webchat-client/inbox/thread (T-webchat-inbox)
  "adminWebchat",
  "adminZalo",
  "adminCostAlerts",
  "amenities",
  "quickDateFilter",
  // 미수/여신 목록(/receivables) — receivables-table 클라 래퍼(페이지네이션 추출)
  "adminReceivables",
  // 리스트 공통 페이지네이션 바(components/pagination-bar) — 전 목록 페이지 공용
  "pagination",
  // 판매정보 입력 폼(sales-editor·detail-tabs) — ADR-0011
  "bedding",
  "features",
  // 본인 비밀번호 변경 폼(/account) — change-password-form
  "account",
  // 운영자 인앱 알림 벨(components/admin/admin-notification-bell) — admin-vendor-ops C
  "adminNotif",
  // 기간별 요금 캘린더(components/rate-calendar) — ADR-0044, 빌라 상세 요금 탭
  "rateCalendar",
  // 인스타그램 콘텐츠 큐(/marketing/instagram — instagram-queue·instagram-post-card·instagram-settings)
  "adminInstagram",
  // 유튜브 쇼츠 승인 큐(/marketing/youtube — youtube-queue·youtube-short-card·youtube-settings)
  "adminYoutube",
  // 사업 계약서 관리(/contracts — contract-create-form·[id]/contract-actions). 서명본 열람/발송/무효화.
  "adminContracts",
  // 계약 본문·서명 블록 공용 컴포넌트(components/business-contract/contract-document) — 포털 공용 NS.
  "businessContract",
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // S-RBAC-3: 운영자 전체(OWNER/MANAGER/STAFF/ADMIN) 진입 허용. 재무 마스킹은 각 화면 책임.
  // 무효 세션(비번 변경 후 stale 토큰 포함)은 /logout으로 — 쿠키를 지워 /login↔/account 루프 차단.
  // (유효 세션이지만 비운영자는 /login으로 바운스 — 미들웨어가 역할 홈으로 보냄)
  if (!session?.user?.id) {
    redirect("/logout");
  }
  if (!isOperator(session.user.role)) {
    redirect("/login");
  }

  // i18n/request.ts(cookie locale, 기본 ko)와 동일한 locale로 서버/클라이언트 일치 유지
  const locale = await getLocale();
  const allMessages = (await import(`../../messages/${locale}.json`)).default;
  const messages = pickMessages(allMessages, ADMIN_CLIENT_NAMESPACES);

  // 코치마크 "?" 재생 버튼 — 문구는 페이지 RSC가 번역해 props로 전달(ADMIN_CLIENT_NAMESPACES 무변경).
  // 같은 노드를 사이드바 푸터·모바일 헤더 두 슬롯에 렌더(독립 인스턴스, 상태 공유 없음).
  const tTour = await getTranslations({ locale, namespace: "tour" });
  const tourHelp = (
    <TourHelpButton
      label={tTour("help")}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-white active:scale-95"
    />
  );

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
        tourHelp={tourHelp}
      />
      {/* 모바일 당겨서 새로고침 — 전 admin 페이지 공용(풀스크린 라우트 자동 제외) */}
      <PullToRefresh fullscreenPrefixes={ADMIN_FULLSCREEN_PREFIXES} variant="dark" />
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
