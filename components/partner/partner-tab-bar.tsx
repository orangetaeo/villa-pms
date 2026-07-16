"use client";

// 파트너 포털 하단 탭바 (ADR-0028 PP3) — 예약현황·미수·제안서 3탭.
// 라벨은 서버 레이아웃(getTranslations("partner"))에서 props로 주입 — 클라 네임스페이스
// 직렬화를 피해 누수면을 최소화한다(파트너 화면엔 운영 라벨 비노출).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  { href: "/partner", icon: "event_available", key: "bookings" },
  { href: "/partner/receivables", icon: "request_quote", key: "receivables" },
  { href: "/partner/proposals", icon: "description", key: "proposals" },
  { href: "/partner/contract", icon: "gavel", key: "contract" },
] as const;

export function PartnerTabBar() {
  const t = useTranslations("partner.tabs");
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/partner"
      ? pathname === "/partner"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      data-tour="partner-tab-bar"
      className="fixed bottom-0 left-0 z-50 flex h-16 w-full items-center justify-around border-t border-neutral-100 bg-white px-1 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]"
    >
      {TABS.map((tab) => {
        const active = isActive(tab.href);
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
            <span className="max-w-full truncate text-[11px] font-medium">
              {t(tab.key)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
