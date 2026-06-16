"use client";

// 언어 전환 토글 (VI/KO) — 공급자·인증 화면 우측 상단 고정.
// 기본 vi, 한국어 전환 가능. pref-locale 쿠키(사용자 명시 선택)를 기록하고,
// 로그인 사용자는 /api/locale로 계정 기본 locale을 DB에 영속한다.
// 라벨은 언어명 그 자체(VI/KO)라 번역 네임스페이스가 필요 없다 → provider 의존 없음.
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import type { AppLocale } from "@/lib/locale";

const LOCALES: { code: AppLocale; label: string; aria: string }[] = [
  { code: "vi", label: "VI", aria: "Tiếng Việt" },
  { code: "ko", label: "KO", aria: "한국어" },
];

// 풀스크린 플로우(빌라 등록 마법사)에서는 자체 상단바와 겹치므로 숨김 — TabBar와 동일 규칙
const FULLSCREEN_PREFIXES = ["/my-villas/new"];

const ONE_YEAR = 60 * 60 * 24 * 365;

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value};path=/;max-age=${ONE_YEAR};samesite=lax`;
}

export function LocaleSwitcher({
  current,
  persist = false,
}: {
  current: AppLocale;
  /** 로그인 사용자: 계정 기본 locale을 DB에 영속(/api/locale). 비로그인 화면은 false. */
  persist?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  if (FULLSCREEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const change = (code: AppLocale) => {
    if (code === current || pending) return;
    // next-intl(i18n/request.ts)이 읽는 `locale`과 사용자 선택 `pref-locale`을 즉시 반영.
    // router.refresh()가 새 쿠키로 RSC를 다시 렌더 → 화면 언어 즉시 전환.
    setCookie("pref-locale", code);
    setCookie("locale", code);
    if (persist) {
      // 실패해도 쿠키로 동작하므로 fire-and-forget
      fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: code }),
      }).catch(() => {});
    }
    startTransition(() => router.refresh());
  };

  return (
    <div
      className="fixed right-3 top-3 z-[60] flex items-center gap-0.5 rounded-full border border-neutral-200 bg-white/90 p-0.5 shadow-sm backdrop-blur"
      role="group"
      aria-label="Language / Ngôn ngữ / 언어"
    >
      {LOCALES.map(({ code, label, aria }) => {
        const active = code === current;
        return (
          <button
            key={code}
            type="button"
            onClick={() => change(code)}
            aria-label={aria}
            aria-pressed={active}
            disabled={pending}
            className={
              active
                ? "rounded-full bg-teal-600 px-2.5 py-1 text-xs font-bold text-white"
                : "rounded-full px-2.5 py-1 text-xs font-semibold text-neutral-500 transition-colors hover:text-neutral-800 disabled:opacity-50"
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
