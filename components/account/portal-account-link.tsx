"use client";

// 라이트 포털 공용 계정 진입 버튼 — 좌측 상단 고정(우측 상단 LocaleSwitcher와 대칭).
//   SUPPLIER(/profile)·VENDOR(/vendor/profile)·PARTNER(/partner/profile) 공용 — href만 다름.
//   계정 화면 자신 및 풀스크린 플로우(빌라 등록 마법사 등)에서는 숨김.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

// 기본: 좌상단 고정(헤더 없는 SUPPLIER/VENDOR 셸). PARTNER는 헤더가 있어 인라인 className 주입.
const DEFAULT_CLASS =
  "fixed left-3 top-3 z-[60] flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white/90 text-neutral-600 shadow-sm backdrop-blur transition-colors hover:text-teal-600";

export function PortalAccountLink({
  href,
  fullscreenPrefixes = [],
  className = DEFAULT_CLASS,
}: {
  href: string;
  /** 진입 버튼을 숨길 풀스크린 경로 접두(예: ["/my-villas/new"]). */
  fullscreenPrefixes?: string[];
  /** 위치/스타일 override(기본=좌상단 고정). 헤더 인라인 배치 시 전달. */
  className?: string;
}) {
  const t = useTranslations("account");
  const pathname = usePathname();

  if (fullscreenPrefixes.some((p) => pathname.startsWith(p))) return null;
  // 계정 화면 자신에서는 중복 진입 숨김
  if (pathname === href) return null;

  return (
    <Link
      href={href}
      aria-label={t("title")}
      title={t("title")}
      className={className}
    >
      <span className="material-symbols-outlined text-[20px]">account_circle</span>
    </Link>
  );
}
