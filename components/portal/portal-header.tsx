"use client";

// 라이트 포털 공용 상단 헤더 — SUPPLIER·VENDOR·PARTNER·CLEANER 4개 포털 동일 형태.
//   [계정 아이콘] Villa Go 로고 · 이름              [알림 등] [VI/KO]
//   sticky(흐름 내부) 헤더라 본문을 밀어내므로, 기존 fixed 방식처럼 제목과 겹치지 않는다.
//   - PARTNER는 원래 자체 헤더가 이 형태였고, 나머지 포털은 흩어진 fixed 요소였다 → 통일.
//   - 자체 앱바를 그리는 상세/풀스크린 경로(fullscreenPrefixes)에서는 숨겨 중앙 제목과 겹침을 막는다.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { PortalAccountLink } from "@/components/account/portal-account-link";
import type { AppLocale } from "@/lib/locale";

// 헤더 인라인 계정 아이콘(좌상단 고정 대신 헤더 안 배치).
const INLINE_ACCOUNT_CLASS =
  "mr-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition-colors hover:text-teal-600";

export function PortalHeader({
  locale,
  brandHref,
  accountHref,
  name = null,
  showLocale = true,
  showAccount = true,
  fullscreenPrefixes = [],
  right,
}: {
  locale: AppLocale;
  /** 로고 클릭 시 이동할 포털 홈. */
  brandHref: string;
  /** 계정 아이콘 링크(예: /profile, /vendor/profile, /partner/profile). */
  accountHref: string;
  /** 로고 옆에 병기할 계정/파트너사 이름(예: · 모두투어). null이면 미표시. */
  name?: string | null;
  /** 언어 전환 노출(CLEANER는 vi 고정이라 false). */
  showLocale?: boolean;
  /** 계정 아이콘 노출(파트너 미승인 등에서 false). */
  showAccount?: boolean;
  /** 헤더를 숨길 풀스크린/자체 앱바 경로 접두. */
  fullscreenPrefixes?: string[];
  /** 언어 전환 왼쪽에 배치할 추가 액션(예: 알림 벨). */
  right?: React.ReactNode;
}) {
  const pathname = usePathname();
  if (fullscreenPrefixes.some((p) => pathname.startsWith(p))) return null;

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-neutral-100 bg-white/90 px-4 py-3 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        {showAccount && (
          <PortalAccountLink href={accountHref} className={INLINE_ACCOUNT_CLASS} />
        )}
        <Link
          href={brandHref}
          aria-label="Villa Go"
          className="flex shrink-0 items-center gap-1.5"
        >
          <VillaGoMark className="h-7 w-7" />
          <VillaGoWordmark className="text-lg" />
        </Link>
        {name && (
          <span className="ml-1 min-w-0 truncate text-sm font-medium text-neutral-500">
            · {name}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right}
        {showLocale && <LocaleSwitcher current={locale} persist inline />}
      </div>
    </header>
  );
}
