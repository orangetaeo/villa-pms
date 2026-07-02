"use client";

// 공급자 하단 탭바 (T1.4) — design/stitch/a6-my-villas BottomNavBar 변환
// 풀스크린 플로우(빌라 등록 마법사 등)에서는 탭바 숨김 — pathname 매칭
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  SUPPLIER_FULLSCREEN_PREFIXES,
  SUPPLIER_OWN_HEADER_PREFIXES,
} from "./tab-bar-constants";
// 하위호환 재수출 — 기존 `@/components/supplier/tab-bar`에서 상수를 import하던 클라이언트 코드 유지.
// (서버 컴포넌트는 반드시 ./tab-bar-constants에서 직접 import — 이 재수출은 client 참조로 바뀜)
export { SUPPLIER_FULLSCREEN_PREFIXES, SUPPLIER_OWN_HEADER_PREFIXES };

const TABS = [
  { href: "/my-villas", icon: "house", key: "villas" },
  { href: "/calendar", icon: "calendar_month", key: "calendar" },
  { href: "/my-bookings", icon: "book_online", key: "bookings" }, // T10.5 직접예약 검수 진입점
  { href: "/cleaning", icon: "cleaning_services", key: "cleaning" },
  { href: "/earnings", icon: "payments", key: "earnings" },
  { href: "/guide", icon: "help", key: "guide" }, // 온보딩 가이드 (T4.3)
] as const;

// 청소 담당(CLEANER)은 배정된 청소 태스크(/cleaning)만 접근 가능(CLAUDE.md 역할표).
// 공급자 전용 탭(빌라·캘린더·직접예약·수익·안내)은 라우트 가드가 CLEANER를 "/"로 되돌려
// 리다이렉트 체인(프리페치 시 ERR_TOO_MANY_REDIRECTS)을 일으키므로 탭 자체를 숨긴다.
// (안내/guide도 SUPPLIER 전용이라 제외. 비밀번호·로그아웃은 상단 AccountLink로 접근.)
const CLEANER_TAB_KEYS = new Set(["cleaning"]);

export function TabBar({ role }: { role?: string }) {
  const t = useTranslations("tabs");
  const pathname = usePathname();

  if (SUPPLIER_FULLSCREEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }

  // CLEANER는 청소·안내만 — 공급자 탭 노출 시 리다이렉트 루프 발생(H3)
  const tabs = role === "CLEANER" ? TABS.filter((tab) => CLEANER_TAB_KEYS.has(tab.key)) : TABS;

  return (
    <>
      {/* 본문 하단 패딩 확보용 스페이서 — 고정 탭바에 콘텐츠가 가리지 않도록 */}
      <div aria-hidden className="h-20" />
      <nav className="fixed bottom-0 left-0 z-50 flex h-16 w-full items-center justify-around rounded-t-xl border-t border-neutral-100 bg-white px-1 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl bg-teal-50 px-1 py-1 font-bold text-teal-600 transition-transform duration-150 active:scale-95"
                  : "flex min-w-0 flex-1 flex-col items-center justify-center px-1 py-1 text-neutral-500 transition-transform duration-150 active:scale-95"
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
              <span className="max-w-full truncate text-[11px] font-medium">{t(tab.key)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
