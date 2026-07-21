"use client";

// 운영자(ADMIN) 공통 사이드바 — Stitch b9/b10 사이드바 마크업 기준 (T1.2)
// DESIGN.md 표준: 10메뉴 순서 고정(ADR-0003 + 공실 보드 추가) —
//   대시보드/예약/제안/빌라/공실 보드/청소 검수/정산/메시지/사용자/설정
// <1024px: 햄버거 헤더 + 드로어 (b1-mobile 헤더 패턴, T6.7)

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { AppLocale } from "@/lib/locale";
import { canViewFinance, canSetPrice, isSystemAdmin, type Role } from "@/lib/permissions";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import AdminNotificationBell from "@/components/admin/admin-notification-bell";

interface NavLeaf {
  key: string;
  href: string;
  icon: string;
  /** 표시 조건 — 미지정이면 운영자 전체(isOperator). 재무·시스템 메뉴는 역할별 노출 (S-RBAC) */
  cap?: (r?: Role) => boolean;
}

/** 아코디언 그룹 — group은 nav.groups.<group> i18n 키, items는 펼침 시 자식 메뉴 */
interface NavGroup {
  group: string;
  icon: string;
  items: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup =>
  (e as NavGroup).items !== undefined;

const ONE_YEAR = 60 * 60 * 24 * 365;

function setLocaleCookie(name: string, value: string) {
  document.cookie = `${name}=${value};path=/;max-age=${ONE_YEAR};samesite=lax`;
}

// 카테고리 누적으로 네비 줄이 길어져 비슷한 메뉴를 아코디언 그룹으로 묶음(사용자 요청).
// 최상위 = 대시보드 / 예약·판매 / 빌라 운영 / 재무 / 메시지 / 시스템 (6줄)
// 단독 항목(대시보드·메시지)은 그룹 없이 그대로 노출, 나머지는 그룹 펼침 시 표시.
// cap 규칙은 자식 항목에 그대로 유지 — 그룹은 보이는 자식이 0개면 통째로 숨김.
// 도메인별 정리(2026-07 재구성): 중복 '정산'·분산된 '부가서비스'로 인한 혼란 해소.
//  - settlements(빌라 공급자 월정산)와 serviceOrders(부가서비스 공급자 정산)를 다른 그룹으로 분리 →
//    라벨도 각각 "빌라 정산"/"부가서비스 정산"으로 구분(중복 '정산' 제거).
//  - 부가서비스(카탈로그+정산)를 한 그룹으로, 파트너(관리+미수/여신)를 한 그룹으로 통합.
//  - 공실 보드는 판매 도구이므로 예약·판매로 이동. 재무는 매출·빌라정산·통계로 슬림화.
//  - 순서: 매일 쓰는 운영성(판매→빌라운영→부가서비스) 상단, 주기적 재무·시스템 하단.
const NAV: NavEntry[] = [
  { key: "dashboard", href: "/dashboard", icon: "dashboard" },
  {
    group: "sales",
    icon: "sell",
    items: [
      { key: "bookings", href: "/bookings", icon: "calendar_month" },
      // 제안=재무(canViewFinance) — STAFF 미노출. 클릭 시 게이트로도 차단되지만 메뉴부터 숨김
      { key: "proposals", href: "/proposals", icon: "rate_review", cap: canViewFinance },
      // 공실 보드 — 비공개 재고 판매 도구라 판매 그룹으로 이동(전 운영자 노출)
      { key: "availability", href: "/availability", icon: "event_available" },
    ],
  },
  {
    group: "operations",
    icon: "villa",
    items: [
      { key: "villas", href: "/villas", icon: "villa" },
      { key: "inspections", href: "/inspections", icon: "cleaning_services" },
      // 미니바 실재고(ADR-0019 S1). cap 미지정=전 운영자 노출
      { key: "inventory", href: "/inventory", icon: "inventory_2" },
      // 지역(단지) 마스터(ADR-0046) — 빌라·업체 공통 단지명 단일 원천. cap 미지정=전 운영자(API도 isOperator)
      { key: "complexAreas", href: "/settings/complex-areas", icon: "apartment" },
    ],
  },
  {
    // 부가서비스 도메인 통합(ADR-0019 S2 카탈로그 + ADR-0023 정산) — 두 곳 분산 혼란 해소
    group: "addon",
    icon: "room_service",
    items: [
      // 서비스 카탈로그 — 가격 설정 권한(canSetPrice=OWNER/MANAGER)만 노출
      { key: "services", href: "/settings/services", icon: "restaurant", cap: canSetPrice },
      // 부가서비스 정산 허브(ADR-0023) — 중계현황 + 공급자별 입금 처리. costVnd 지급 경계라 재무만 노출
      { key: "serviceOrders", href: "/service-orders", icon: "payments", cap: canViewFinance },
      // 부가서비스 원천 공급자 관리(ADR-0023) — 설정 박스에서 이동 2026-07-12. cap 없음=전 운영자(구 설정 박스와 동일 접근성)
      { key: "vendors", href: "/settings/vendors", icon: "storefront" },
    ],
  },
  {
    // 파트너 도메인 통합(ADR-0022) — 여행사·랜드사 관리 + 채권. 재무만 노출
    group: "partner",
    icon: "handshake",
    items: [
      { key: "partners", href: "/partners", icon: "handshake", cap: canViewFinance },
      // 미수/여신 대시보드(ADR-0022 PARTNER-3) — 전 파트너 미수 Aging·연체
      { key: "receivables", href: "/receivables", icon: "request_quote", cap: canViewFinance },
    ],
  },
  {
    group: "finance",
    icon: "account_balance_wallet",
    items: [
      // 매출관리(건별 매출 거래 목록) — 객실료·미니바·부가서비스 통합. 마진·판매가 비공개라 재무만 노출
      { key: "revenue", href: "/revenue", icon: "receipt_long", cap: canViewFinance },
      // 빌라 공급자 월정산(부가서비스 정산과 구분되는 라벨 "빌라 정산")
      { key: "settlements", href: "/settlements", icon: "account_balance", cap: canViewFinance },
      // 통계(T-admin-statistics) — 전 운영자 노출(탭별 금액 게이트는 페이지 내부)
      { key: "statistics", href: "/statistics", icon: "analytics" },
    ],
  },
  {
    // 마케팅 도메인(인스타그램·유튜브 콘텐츠 큐) — 특정 계정(테오 phone) 단일 노출.
    // 역할 cap이 아니라 showMarketing prop으로 그룹 통째 필터(아래 navEntries). 페이지 게이트도 동일.
    group: "marketing",
    icon: "campaign",
    items: [
      { key: "instagram", href: "/marketing/instagram", icon: "photo_camera" },
      { key: "youtube", href: "/marketing/youtube", icon: "smart_display" },
    ],
  },
  { key: "messages", href: "/messages", icon: "chat" },
  {
    group: "system",
    icon: "settings",
    items: [
      // 사용자·설정=시스템(isSystemAdmin) — OWNER만 노출 (MANAGER/STAFF 미노출)
      { key: "users", href: "/users", icon: "group", cap: isSystemAdmin },
      { key: "settings", href: "/settings", icon: "settings", cap: isSystemAdmin },
      // 공휴일 캘린더(ADR-0042) — 프리미엄 박 판정의 공휴일 축. 설정과 동일 등급(isSystemAdmin)
      { key: "holidays", href: "/settings/holidays", icon: "event", cap: isSystemAdmin },
      // 사업 계약서 문서 뷰어 — 마진 전략·원가 구조 포함이라 재무 등급만(canViewFinance=OWNER/MANAGER, STAFF 숨김)
      { key: "documents", href: "/documents", icon: "description", cap: canViewFinance },
      // 계약 전자서명 관리(T-business-contract-esign) — 상대 발송·서명본 열람. 재무 등급만(FINANCE_PATHS).
      { key: "contracts", href: "/contracts", icon: "history_edu", cap: canViewFinance },
    ],
  },
];

export default function AdminSidebar({
  userName,
  role,
  unreadCount = 0,
  logoutAction,
  currentLocale = "ko",
  tourHelp,
  showMarketing = false,
}: {
  userName?: string | null;
  /** 사용자 역할 — NAV 역할별 필터 + 역할 라벨 표시 (S-RBAC) */
  role?: Role;
  /** 마케팅 그룹 노출 여부 — 특정 계정(테오 phone) 전용. 레이아웃이 서버에서 판정해 주입. */
  showMarketing?: boolean;
  /** 메시지 메뉴 미읽음 합계 뱃지 (T6.6, b14) */
  unreadCount?: number;
  /** 로그아웃 서버 액션 (layout에서 NextAuth signOut 주입) */
  logoutAction?: () => Promise<void>;
  /** 현재 표시 언어 — 하단 VI/KO 토글 활성 상태 표시 (베트남 직원 직접 관리 대응) */
  currentLocale?: AppLocale;
  /** 코치마크 "?" 재생 버튼(layout RSC가 번역해 주입) — 데스크톱 푸터·모바일 헤더 두 곳 렌더. */
  tourHelp?: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const tRoles = useTranslations("adminUsers");
  // 역할별 NAV 필터 — cap 미지정은 운영자 전체 노출, 재무·시스템 메뉴는 역할 충족 시만.
  // 그룹은 보이는 자식이 0개면 통째로 제거.
  const canSee = (leaf: NavLeaf) => !leaf.cap || leaf.cap(role);
  const navEntries: NavEntry[] = NAV.flatMap((e): NavEntry[] => {
    if (!isGroup(e)) return canSee(e) ? [e] : [];
    // 마케팅은 역할이 아니라 특정 계정(테오 phone) 전용 — showMarketing 미충족 시 그룹 통째 숨김.
    if (e.group === "marketing" && !showMarketing) return [];
    const items = e.items.filter(canSee);
    return items.length ? [{ ...e, items }] : [];
  });
  // 모바일 하단 네비 중앙 돌출 항목 — 재무 권한자는 매출관리,
  // 권한 없는 STAFF는 공실 보드로 대체(매출관리는 미들웨어 차단 대상이라 노출 금지)
  const centerItem = canViewFinance(role)
    ? { href: "/revenue", icon: "receipt_long", key: "revenue" }
    : { href: "/availability", icon: "event_available", key: "availability" };
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // 아코디언 펼침 상태 — 사용자가 토글한 그룹만 기록. 미기록 그룹은 활성 경로 포함 시 자동 펼침.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // current=현재 펼침 여부(자동 펼침 포함) — 그 반대로 명시 기록
  const toggleGroup = (g: string, current: boolean) =>
    setOpenGroups((prev) => ({ ...prev, [g]: !current }));

  // 경로 이동 시 드로어 자동 닫기
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  // 언어 전환 — pref-locale(사용자 선택)·locale(next-intl 읽는 값) 쿠키 즉시 반영 후
  // 계정 기본 locale을 DB에 영속(/api/locale), router.refresh로 RSC 재렌더.
  const changeLocale = (code: AppLocale) => {
    if (code === currentLocale || pending) return;
    setLocaleCookie("pref-locale", code);
    setLocaleCookie("locale", code);
    fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: code }),
    }).catch(() => {});
    startTransition(() => router.refresh());
  };

  // 하단 네비 일반 항목 (좌/우) — 아이콘 + 라벨, 활성 강조 + 미읽음 배지
  const BottomItem = ({
    href,
    icon,
    label,
    badge = 0,
  }: {
    href: string;
    icon: string;
    label: string;
    badge?: number;
  }) => {
    const active = isActive(href);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`relative flex flex-col items-center justify-center gap-0.5 w-16 transition-transform active:scale-95 ${
          active ? "text-admin-primary" : "text-slate-400"
        }`}
      >
        <span
          className={
            active
              ? "material-symbols-outlined text-[22px] [font-variation-settings:'FILL'_1]"
              : "material-symbols-outlined text-[22px]"
          }
        >
          {icon}
        </span>
        <span className="text-[10px] font-medium">{label}</span>
        {badge > 0 && (
          <span className="absolute top-0 right-2 bg-blue-600 text-white text-[9px] font-black px-1.5 py-px rounded-full leading-tight">
            {badge}
          </span>
        )}
      </Link>
    );
  };
  // 사이드바 단일 메뉴 링크 (그룹 자식은 indented로 들여쓰기)
  const NavLeafLink = ({
    item,
    indented = false,
  }: {
    item: NavLeaf;
    indented?: boolean;
  }) => {
    const active = isActive(item.href);
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={
          (active
            ? "bg-admin-card text-admin-primary font-bold"
            : "text-admin-muted hover:text-white hover:bg-admin-card font-medium transition-colors duration-200") +
          " flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm" +
          (indented ? " pl-9" : "")
        }
      >
        <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
        <span className="flex-1">{t(item.key)}</span>
        {item.key === "messages" && unreadCount > 0 && (
          <span
            className={
              active
                ? "bg-admin-primary text-white text-[10px] font-black px-1.5 py-0.5 rounded-full"
                : "bg-blue-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full"
            }
          >
            {unreadCount}
          </span>
        )}
      </Link>
    );
  };

  // 아코디언 그룹 — 헤더 클릭으로 펼침/접힘. 활성 경로 포함 그룹은 기본 펼침,
  // 접힌 채로 활성 자식을 가지면 헤더를 강조색으로 표시(현 위치 표지).
  const NavGroupBlock = ({ group }: { group: NavGroup }) => {
    const containsActive = group.items.some((it) => isActive(it.href));
    const expanded = openGroups[group.group] ?? containsActive;
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => toggleGroup(group.group, expanded)}
          aria-expanded={expanded}
          className={
            (containsActive && !expanded
              ? "text-admin-primary "
              : "text-admin-muted ") +
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:text-white hover:bg-admin-card transition-colors duration-200"
          }
        >
          <span className="material-symbols-outlined text-[20px]">{group.icon}</span>
          <span className="flex-1 text-left">{t(`groups.${group.group}`)}</span>
          <span
            className={
              "material-symbols-outlined text-[20px] transition-transform duration-200 " +
              (expanded ? "rotate-180" : "")
            }
          >
            expand_more
          </span>
        </button>
        {expanded && (
          <div className="flex flex-col gap-1">
            {group.items.map((it) => (
              <NavLeafLink key={it.key} item={it} indented />
            ))}
          </div>
        )}
      </div>
    );
  };

  const centerActive = isActive(centerItem.href);

  return (
    <>
      {/* 모바일 헤더 (b1-mobile 패턴): 햄버거 + 브랜드 */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-4">
        <button
          type="button"
          aria-label={open ? t("closeMenu") : t("openMenu")}
          onClick={() => setOpen((v) => !v)}
          className="text-slate-300 hover:bg-slate-800 rounded-lg p-2 -ml-2 transition-colors"
        >
          <span className="material-symbols-outlined">{open ? "close" : "menu"}</span>
        </button>
        <Link
          href="/dashboard"
          aria-label={t("dashboard")}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 leading-none"
        >
          <VillaGoMark className="h-6 w-auto" />
          <div className="flex flex-col items-start gap-0.5">
            <VillaGoWordmark
              className="text-base"
              villa="text-white"
              go="text-teal-400"
            />
            <span className="text-[8px] text-slate-500 uppercase tracking-widest font-bold">
              {t("brandSub")}
            </span>
          </div>
        </Link>
        {/* 우측: 코치마크 "?" (투어 화면에서만 렌더 — 로고는 absolute 중앙이라 균형 무관) */}
        <div className="flex w-10 items-center justify-end">{tourHelp}</div>
      </header>

      {/* 드로어 오버레이 */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      {/* 사이드바 (b9 마크업 기준) — 데스크톱 고정, 모바일 드로어
          ★ h-[100dvh]: 모바일 크롬 하단 툴바가 100vh에 포함돼 하단 푸터(프로필·아이콘·언어)가
            툴바 뒤로 짤리던 버그 수정(dvh=실제 보이는 뷰포트). pb 세이프에어리어로 iOS 홈바도 회피. */}
      <aside
        className={`h-[100dvh] w-64 fixed left-0 top-0 bg-admin-bg border-r border-admin-card flex flex-col px-4 pt-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] gap-2 z-50 transition-transform duration-200 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link
          href="/dashboard"
          aria-label={t("dashboard")}
          className="px-2 py-4 mb-4 flex items-center gap-2.5 rounded-lg hover:bg-admin-card transition-colors duration-200"
        >
          <VillaGoMark className="h-9 w-auto shrink-0" />
          <div>
            <VillaGoWordmark
              className="text-xl"
              villa="text-white"
              go="text-teal-400"
            />
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
              {t("brandSub")}
            </p>
          </div>
        </Link>
        <nav data-tour="admin-nav" className="flex-1 flex flex-col gap-1 overflow-y-auto">
          {navEntries.map((entry) =>
            isGroup(entry) ? (
              <NavGroupBlock key={entry.group} group={entry} />
            ) : (
              <NavLeafLink key={entry.key} item={entry} />
            ),
          )}
        </nav>
        {/* relative — 알림 벨 드롭업 패널(absolute)의 positioning 컨테이너 (fixed 금지) */}
        <div className="relative pt-4 mt-auto border-t border-admin-card flex flex-col gap-3 px-2">
          {/* 프로필(아바타+이름/역할)은 한 줄, 액션 아이콘(알림·계정·로그아웃)은 아래 줄로 분리.
              256px 사이드바에서 한 줄에 다 넣으면 이름이 짓눌려 짤림 — 2줄 배치로 이름 폭 확보. */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-admin-primary flex items-center justify-center text-xs font-bold text-white shrink-0">
              {(userName ?? t("profileName")).slice(0, 1)}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-bold text-white leading-tight truncate">
                {userName ?? t("profileName")}
              </span>
              <span className="text-[10px] text-admin-muted truncate">
                {role ? tRoles(`roles.${role}`) : t("profileRole")}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1">
            {/* 코치마크 "?" 재생 (T-tutorial-onboarding-3) — 투어 정의 화면에서만 렌더 */}
            {tourHelp}
            {/* 인앱 알림 벨 (admin-vendor-ops C) — 벤더 수락/거절/제안/완료·가입대기.
                코치마크 앵커 — 모바일에선 드로어 안(비가시)이라 해당 스텝 자동 스킵 */}
            <span className="inline-flex" data-tour="admin-bell">
              <AdminNotificationBell />
            </span>
            {/* 본인 비밀번호 변경 진입 (/account) */}
            <Link
              href="/account"
              aria-label={t("account")}
              title={t("account")}
              className="text-admin-muted hover:text-white hover:bg-admin-card rounded-lg p-2 transition-colors duration-200"
            >
              <span className="material-symbols-outlined text-[20px]">manage_accounts</span>
            </Link>
            {/* 로그아웃 — NextAuth signOut 서버 액션, 완료 후 /login */}
            {logoutAction && (
              <form action={logoutAction}>
                <button
                  type="submit"
                  aria-label={t("logout")}
                  title={t("logout")}
                  className="text-admin-muted hover:text-white hover:bg-admin-card rounded-lg p-2 transition-colors duration-200"
                >
                  <span className="material-symbols-outlined text-[20px]">logout</span>
                </button>
              </form>
            )}
          </div>
          {/* 언어 토글(VI/KO) — 베트남 직원이 직접 운영 화면을 쓸 수 있도록. 다크 테마 */}
          <div
            className="flex items-center gap-0.5 rounded-lg bg-admin-card p-0.5"
            role="group"
            aria-label="Language / Ngôn ngữ / 언어"
          >
            {(
              [
                { code: "vi", label: "VI", aria: "Tiếng Việt" },
                { code: "ko", label: "KO", aria: "한국어" },
              ] as const
            ).map(({ code, label, aria }) => {
              const active = code === currentLocale;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => changeLocale(code)}
                  aria-label={aria}
                  aria-pressed={active}
                  disabled={pending}
                  className={
                    active
                      ? "flex-1 rounded-md bg-admin-primary px-2.5 py-1.5 text-xs font-bold text-white"
                      : "flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-admin-muted transition-colors hover:text-white disabled:opacity-50"
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* 모바일 하단 네비게이션 (Nike 스타일 — 중앙 돌출 FAB). lg 이상은 좌측 사이드바 사용.
          /messages 등 풀스크린 라우트도 표시(각 화면이 네비 높이만큼 자체 높이 보정) */}
      {/* 코치마크 앵커 — admin-nav 이중앵커의 모바일 쪽(데스크톱에선 display:none → 비가시 스킵) */}
      <nav
        data-tour="admin-nav"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 flex items-stretch justify-around px-1"
      >
        <BottomItem href="/dashboard" icon="dashboard" label={t("dashboard")} />
        <BottomItem href="/bookings" icon="calendar_month" label={t("bookings")} />

        {/* 중앙 돌출 강조 — 정산(재무) / STAFF는 공실 보드 */}
        <Link
          href={centerItem.href}
          aria-current={centerActive ? "page" : undefined}
          className="relative flex w-16 flex-col items-center justify-end pb-1.5"
        >
          <span
            className={`absolute -top-6 flex h-14 w-14 items-center justify-center rounded-full text-white ring-4 ring-admin-bg transition-transform active:scale-95 ${
              centerActive
                ? "bg-admin-primary shadow-lg shadow-admin-primary/40"
                : "bg-admin-primary/90 shadow-lg shadow-admin-primary/20"
            }`}
          >
            <span className="material-symbols-outlined">{centerItem.icon}</span>
          </span>
          <span
            className={`text-[10px] font-bold ${centerActive ? "text-admin-primary" : "text-slate-400"}`}
          >
            {t(centerItem.key)}
          </span>
        </Link>

        <BottomItem href="/messages" icon="chat" label={t("messages")} badge={unreadCount} />

        {/* 더보기 — 기존 드로어(open) 열기 */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("openMenu")}
          className="flex w-16 flex-col items-center justify-center gap-0.5 text-slate-400 transition-transform active:scale-95"
        >
          <span className="material-symbols-outlined text-[22px]">menu</span>
          <span className="text-[10px] font-medium">{t("more")}</span>
        </button>
      </nav>
    </>
  );
}
