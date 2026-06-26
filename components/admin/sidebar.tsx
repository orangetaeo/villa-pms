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

interface NavItem {
  key: string;
  href: string;
  icon: string;
  /** 표시 조건 — 미지정이면 운영자 전체(isOperator). 재무·시스템 메뉴는 역할별 노출 (S-RBAC) */
  cap?: (r?: Role) => boolean;
}

const ONE_YEAR = 60 * 60 * 24 * 365;

function setLocaleCookie(name: string, value: string) {
  document.cookie = `${name}=${value};path=/;max-age=${ONE_YEAR};samesite=lax`;
}

// 순서 고정 — DESIGN.md "운영자 표준 사이드바 10메뉴" (화면별 재수정 금지)
// 공실 보드(T-admin-availability-board): 빌라 운영군(빌라→공실 보드→청소 검수)에 배치
const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: "dashboard" },
  { key: "bookings", href: "/bookings", icon: "calendar_month" },
  // 제안·정산=재무(canViewFinance) — STAFF 미노출. 클릭 시 게이트로도 차단되지만 메뉴부터 숨김
  { key: "proposals", href: "/proposals", icon: "rate_review", cap: canViewFinance },
  { key: "villas", href: "/villas", icon: "villa" },
  // 미니바 실재고(ADR-0019 S1) — 빌라 운영군(빌라→재고→공실 보드). cap 미지정=전 운영자 노출
  { key: "inventory", href: "/inventory", icon: "inventory_2" },
  { key: "availability", href: "/availability", icon: "event_available" },
  { key: "inspections", href: "/inspections", icon: "cleaning_services" },
  { key: "settlements", href: "/settlements", icon: "payments", cap: canViewFinance },
  // 파트너 관리(ADR-0022) — 여행사·랜드사 미수·여신. 재무(canViewFinance)만 노출
  { key: "partners", href: "/partners", icon: "handshake", cap: canViewFinance },
  // 통계(T-admin-statistics) — 정산 카테고리 아래 배치(사용자 요청). 전 운영자 노출(탭별 금액 게이트는 페이지 내부)
  { key: "statistics", href: "/statistics", icon: "analytics" },
  // 서비스 카탈로그(ADR-0019 S2) — 부가서비스 판매 메뉴. 가격 설정 권한(canSetPrice=OWNER/MANAGER)만 노출
  { key: "services", href: "/settings/services", icon: "restaurant", cap: canSetPrice },
  { key: "messages", href: "/messages", icon: "chat" },
  // 사용자·설정=시스템(isSystemAdmin) — OWNER만 노출 (MANAGER/STAFF 미노출)
  { key: "users", href: "/users", icon: "group", cap: isSystemAdmin },
  { key: "settings", href: "/settings", icon: "settings", cap: isSystemAdmin },
];

export default function AdminSidebar({
  userName,
  role,
  unreadCount = 0,
  logoutAction,
  currentLocale = "ko",
}: {
  userName?: string | null;
  /** 사용자 역할 — NAV 역할별 필터 + 역할 라벨 표시 (S-RBAC) */
  role?: Role;
  /** 메시지 메뉴 미읽음 합계 뱃지 (T6.6, b14) */
  unreadCount?: number;
  /** 로그아웃 서버 액션 (layout에서 NextAuth signOut 주입) */
  logoutAction?: () => Promise<void>;
  /** 현재 표시 언어 — 하단 VI/KO 토글 활성 상태 표시 (베트남 직원 직접 관리 대응) */
  currentLocale?: AppLocale;
}) {
  const t = useTranslations("nav");
  const tRoles = useTranslations("adminUsers");
  // 역할별 NAV 필터 — cap 미지정은 운영자 전체 노출, 재무·시스템 메뉴는 역할 충족 시만
  const navItems = NAV_ITEMS.filter((item) => !item.cap || item.cap(role));
  // 모바일 하단 네비 중앙 돌출 항목 — 재무 권한자는 정산(추후 매출 페이지와 분리, IDEAS.md),
  // 권한 없는 STAFF는 공실 보드로 대체(정산은 미들웨어 차단 대상이라 노출 금지)
  const centerItem = canViewFinance(role)
    ? { href: "/settlements", icon: "payments", key: "settlements" }
    : { href: "/availability", icon: "event_available", key: "availability" };
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

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
        {/* 우측 균형 유지용 (b1-mobile 알림 자리 — 알림은 T6.x) */}
        <div className="w-10" aria-hidden />
      </header>

      {/* 드로어 오버레이 */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      {/* 사이드바 (b9 마크업 기준) — 데스크톱 고정, 모바일 드로어 */}
      <aside
        className={`h-screen w-64 fixed left-0 top-0 bg-admin-bg border-r border-admin-card flex flex-col p-4 gap-2 z-50 transition-transform duration-200 lg:translate-x-0 ${
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
        <nav className="flex-1 flex flex-col gap-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "flex items-center gap-3 px-3 py-2.5 bg-admin-card text-admin-primary font-bold rounded-lg text-sm"
                    : "flex items-center gap-3 px-3 py-2.5 text-admin-muted hover:text-white hover:bg-admin-card rounded-lg transition-colors duration-200 text-sm font-medium"
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
          })}
        </nav>
        <div className="pt-4 mt-auto border-t border-admin-card flex flex-col gap-3 px-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-admin-primary flex items-center justify-center text-xs font-bold text-white shrink-0">
              {(userName ?? t("profileName")).slice(0, 1)}
            </div>
            <div className="flex flex-col overflow-hidden flex-1">
              <span className="text-sm font-bold text-white leading-none truncate">
                {userName ?? t("profileName")}
              </span>
              <span className="text-[10px] text-admin-muted">
                {role ? tRoles(`roles.${role}`) : t("profileRole")}
              </span>
            </div>
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
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 flex items-stretch justify-around px-1">
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
