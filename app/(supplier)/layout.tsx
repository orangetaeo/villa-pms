import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import {
  TabBar,
  SUPPLIER_FULLSCREEN_PREFIXES,
  SUPPLIER_OWN_HEADER_PREFIXES,
} from "@/components/supplier/tab-bar";
import { PortalHeader } from "@/components/portal/portal-header";
import PullToRefresh from "@/components/pull-to-refresh";
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
  // 빌라 사진 관리(photo-manager)·라이트박스(photo-lightbox) 클라이언트 — 누락 시 사진 화면 라벨이 raw 키로 깨짐.
  "photoManage",
  "photoLightbox",
  // T10.5 — 공급자 체크인·아웃 검수 폼(클라이언트). 운영자 adminCheckin/adminCheckout과 분리된 vi 네임스페이스(누수 차단).
  "supplierCheckin",
  "supplierCheckout",
  // T10.6 — 기간별 원가·판매가 편집기(rate-period-cost-editor, 클라이언트).
  "supplierRatePeriods",
  // T10.7 — 공급자 판매 링크 생성·목록(sell-link-client, 클라이언트). 운영자 마진·KRW 미포함 vi 네임스페이스.
  "supplierSellLink",
  // 공급자 이용규칙·위치/규모 자가 편집기(info-editor, 클라이언트). 운영자 sales(다크)와 분리된 vi 네임스페이스.
  "supplierInfo",
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
  // 무효 세션(비번 변경 후 stale 토큰 포함)은 /logout으로 — 쿠키를 지워 /login↔보호경로 루프 차단.
  if (!session) redirect("/logout");

  // 청소직원(CLEANER)은 베트남 현지 인력 — 항상 베트남어 고정(언어 토글 비노출).
  // 공급자(SUPPLIER)는 기존대로 pref-locale > 계정 기본 > vi (ko 토글 허용).
  const isCleaner = session.user.role === "CLEANER";
  const locale = isCleaner ? "vi" : await getSupplierLocale(session.user.locale);
  const allMessages = (await import(`../../messages/${locale}.json`)).default;
  // [QA D-2] admin·adminXxx 네임스페이스 직렬화 차단 — 화이트리스트만 클라이언트로 전달
  const messages = pickMessages(allMessages);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <NextIntlClientProvider locale={locale} messages={messages}>
        {/* 공용 포털 헤더 — 4개 라이트 포털 동일 형태. 청소직원은 vi 고정이라 언어 전환 숨김.
            자체 앱바 페이지(빌라 상세·검수 하위)에서는 헤더를 숨겨 중앙 제목과 겹침 방지. */}
        <PortalHeader
          locale={locale}
          brandHref="/"
          accountHref="/profile"
          name={session.user.name ?? null}
          showLocale={!isCleaner}
          // 자체 앱바(뒤로가기+제목)를 그리는 상세 경로에서는 공용 헤더 숨김(이중 헤더 방지).
          // 청소 상세(/cleaning/[id])도 fixed 뒤로가기 바가 있어 목록(/cleaning)과 달리 숨긴다.
          fullscreenPrefixes={[...SUPPLIER_OWN_HEADER_PREFIXES, "/cleaning/"]}
        />
        {/* 모바일 당겨서 새로고침 — 공급자 전 화면(라이트 테마, 풀스크린 마법사 제외) */}
        <PullToRefresh fullscreenPrefixes={SUPPLIER_FULLSCREEN_PREFIXES} variant="light" />
        {/* sticky 헤더가 흐름 공간을 차지 → 별도 pt 불필요(페이지 자체 패딩 유지) */}
        <main>{children}</main>
        {/* 하단 탭바 (T1.4) — 풀스크린 플로우에서는 컴포넌트가 스스로 숨김 + 본문 하단 스페이서 포함 */}
        {/* CLEANER는 청소·안내만(H3 리다이렉트 루프 방지) — role 전달로 탭 필터링 */}
        <TabBar role={session.user.role} />
      </NextIntlClientProvider>
    </div>
  );
}
