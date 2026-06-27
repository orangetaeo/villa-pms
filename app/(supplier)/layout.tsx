import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { TabBar, SUPPLIER_FULLSCREEN_PREFIXES } from "@/components/supplier/tab-bar";
import { AccountLink } from "@/components/supplier/account-link";
import PullToRefresh from "@/components/pull-to-refresh";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { getSupplierLocale } from "@/lib/locale";

// [QA D-2] 공급자 클라이언트 컴포넌트가 useTranslations로 실제 사용하는 네임스페이스만 직렬화.
// 전체 messages를 넘기면 adminXxx 라벨(마진·판매가 운영 구조)이 RSC payload에 노출됨.
// 전수 grep 근거: calendar-view(calendar), villa-wizard·step-*(wizard, amenities), tab-bar(tabs).
// 서버 컴포넌트(getTranslations: earnings/cleaning/my-villas 등)는 이 목록과 무관.
// 새 공급자 화면에서 클라이언트 useTranslations 네임스페이스 추가 시 반드시 여기에도 추가할 것.
const SUPPLIER_CLIENT_NAMESPACES = [
  "calendar",
  "wizard",
  "amenities",
  "tabs",
  "account",
  "pagination",
  // T10.5 — 공급자 체크인·아웃 검수 폼(클라이언트). 운영자 adminCheckin/adminCheckout과 분리된 vi 네임스페이스(누수 차단).
  "supplierCheckin",
  "supplierCheckout",
  // T10.6 — 기간별 원가·판매가 편집기(rate-period-cost-editor, 클라이언트).
  "supplierRatePeriods",
  // T10.7 — 공급자 판매 링크 생성·목록(sell-link-client, 클라이언트). 운영자 마진·KRW 미포함 vi 네임스페이스.
  "supplierSellLink",
] as const;

function pickMessages(all: AbstractIntlMessages): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {};
  for (const ns of SUPPLIER_CLIENT_NAMESPACES) {
    if (all[ns] !== undefined) picked[ns] = all[ns];
  }
  return picked;
}

export default async function SupplierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  // 공급자 라우트 유효 locale: 사용자 선택(pref-locale) > 계정 기본 > vi.
  // (i18n/request.ts는 cookie 기반·기본 ko라 여기서 헬퍼로 산출)
  const locale = await getSupplierLocale(session.user.locale);
  const allMessages = (await import(`../../messages/${locale}.json`)).default;
  // [QA D-2] admin·adminXxx 네임스페이스 직렬화 차단 — 화이트리스트만 클라이언트로 전달
  const messages = pickMessages(allMessages);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <NextIntlClientProvider locale={locale} messages={messages}>
        <LocaleSwitcher current={locale} persist />
        <AccountLink />
        {/* 모바일 당겨서 새로고침 — 공급자 전 화면(라이트 테마, 풀스크린 마법사 제외) */}
        <PullToRefresh fullscreenPrefixes={SUPPLIER_FULLSCREEN_PREFIXES} variant="light" />
        {/* pt-14: 좌상단 AccountLink·우상단 LocaleSwitcher(fixed top-3 h-9)와 본문 콘텐츠 겹침 방지(M4) */}
        <main className="pt-14">{children}</main>
        {/* 하단 탭바 (T1.4) — 풀스크린 플로우에서는 컴포넌트가 스스로 숨김 + 본문 하단 스페이서 포함 */}
        {/* CLEANER는 청소·안내만(H3 리다이렉트 루프 방지) — role 전달로 탭 필터링 */}
        <TabBar role={session.user.role} />
      </NextIntlClientProvider>
    </div>
  );
}
