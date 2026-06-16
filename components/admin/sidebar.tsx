"use client";

// 운영자(ADMIN) 공통 사이드바 — Stitch b9/b10 사이드바 마크업 기준 (T1.2)
// DESIGN.md 표준: 9메뉴 순서 고정(ADR-0003) — 대시보드/예약/제안/빌라/청소 검수/정산/메시지/사용자/설정
// <1024px: 햄버거 헤더 + 드로어 (b1-mobile 헤더 패턴, T6.7)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface NavItem {
  key: string;
  href: string;
  icon: string;
}

// 순서 고정 — DESIGN.md "운영자 표준 사이드바 9메뉴" (화면별 재수정 금지)
const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: "dashboard" },
  { key: "bookings", href: "/bookings", icon: "calendar_month" },
  { key: "proposals", href: "/proposals", icon: "rate_review" },
  { key: "villas", href: "/villas", icon: "villa" },
  { key: "inspections", href: "/inspections", icon: "cleaning_services" },
  { key: "settlements", href: "/settlements", icon: "payments" },
  { key: "messages", href: "/messages", icon: "chat" },
  { key: "users", href: "/users", icon: "group" },
  { key: "settings", href: "/settings", icon: "settings" },
];

export default function AdminSidebar({
  userName,
  unreadCount = 0,
  logoutAction,
}: {
  userName?: string | null;
  /** 메시지 메뉴 미읽음 합계 뱃지 (T6.6, b14) */
  unreadCount?: number;
  /** 로그아웃 서버 액션 (layout에서 NextAuth signOut 주입) */
  logoutAction?: () => Promise<void>;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // 경로 이동 시 드로어 자동 닫기
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

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
        <div className="flex flex-col items-center leading-none gap-0.5">
          <span className="text-base font-bold text-white">Villa PMS</span>
          <span className="text-[8px] text-slate-500 uppercase tracking-widest font-bold">
            {t("brandSub")}
          </span>
        </div>
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
        <div className="px-2 py-4 mb-4">
          <h1 className="text-xl font-bold text-white">Villa PMS</h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
            {t("brandSub")}
          </p>
        </div>
        <nav className="flex-1 flex flex-col gap-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
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
        <div className="pt-4 mt-auto border-t border-admin-card flex items-center gap-3 px-2">
          <div className="w-8 h-8 rounded-full bg-admin-primary flex items-center justify-center text-xs font-bold text-white shrink-0">
            {(userName ?? t("profileName")).slice(0, 1)}
          </div>
          <div className="flex flex-col overflow-hidden flex-1">
            <span className="text-sm font-bold text-white leading-none truncate">
              {userName ?? t("profileName")}
            </span>
            <span className="text-[10px] text-admin-muted">{t("profileRole")}</span>
          </div>
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
      </aside>
    </>
  );
}
