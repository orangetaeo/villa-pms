"use client";

// 공급자 하단 탭바 (T1.4) — design/stitch/a6-my-villas BottomNavBar 변환
// 풀스크린 플로우(빌라 등록 마법사 등)에서는 탭바 숨김 — pathname 매칭
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  { href: "/my-villas", icon: "house", key: "villas" },
  { href: "/calendar", icon: "calendar_month", key: "calendar" },
  { href: "/cleaning", icon: "cleaning_services", key: "cleaning" },
  { href: "/earnings", icon: "payments", key: "earnings" },
  { href: "/guide", icon: "help", key: "guide" }, // 온보딩 가이드 (T4.3)
] as const;

/** 탭바를 숨기는 풀스크린 플로우 경로 접두사 (당겨서 새로고침도 동일하게 제외) */
export const SUPPLIER_FULLSCREEN_PREFIXES = ["/my-villas/new"];

export function TabBar() {
  const t = useTranslations("tabs");
  const pathname = usePathname();

  if (SUPPLIER_FULLSCREEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }

  return (
    <>
      {/* 본문 하단 패딩 확보용 스페이서 — 고정 탭바에 콘텐츠가 가리지 않도록 */}
      <div aria-hidden className="h-20" />
      <nav className="fixed bottom-0 left-0 z-50 flex h-16 w-full items-center justify-around rounded-t-xl border-t border-neutral-100 bg-white px-2 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "flex flex-col items-center justify-center rounded-xl bg-teal-50 px-3 py-1 font-bold text-teal-600 transition-transform duration-150 active:scale-95"
                  : "flex flex-col items-center justify-center px-3 py-1 text-neutral-500 transition-transform duration-150 active:scale-95"
              }
            >
              <span
                className={
                  active
                    ? "material-symbols-outlined [font-variation-settings:'FILL'_1]"
                    : "material-symbols-outlined"
                }
              >
                {tab.icon}
              </span>
              <span className="text-xs font-medium">{t(tab.key)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
