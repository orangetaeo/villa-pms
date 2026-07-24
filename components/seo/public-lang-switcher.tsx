"use client";

// components/seo/public-lang-switcher.tsx — 공개 홈 5개 언어 전환 (테오 2026-07-24)
//
// pub-locale 쿠키만 기록하고 router.refresh() → 서버가 새 로케일로 홈을 다시 렌더한다.
// ★ 전역 next-intl(admin ko / supplier vi)과 분리 — locale/pref-locale 쿠키는 건드리지 않는다.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PUBLIC_LOCALES, type PublicLocale } from "@/lib/seo/public-i18n";

const ONE_YEAR = 60 * 60 * 24 * 365;

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}

export default function PublicLangSwitcher({
  current,
  links,
}: {
  current: PublicLocale;
  /**
   * 로케일별 대상 URL. 있으면(블로그 등 URL이 언어 진실원천인 페이지) 쿠키 기록 후 그 URL로 이동한다.
   * 없으면(홈 등 쿠키-렌더 페이지) 기존 동작 — 쿠키만 바꾸고 router.refresh().
   */
  links?: Partial<Record<PublicLocale, string>>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (code: PublicLocale) => {
    setOpen(false);
    if (code === current) return;
    document.cookie = `pub-locale=${code};path=/;max-age=${ONE_YEAR};samesite=lax`;
    const href = links?.[code];
    if (href) {
      // 블로그: 콘텐츠 언어 진실원천은 URL이라 해당 언어 URL로 이동한다(refresh 아님).
      startTransition(() => router.push(href));
    } else {
      // 홈: 쿠키 기반 렌더 — 쿠키만 바꾸고 서버 재렌더.
      startTransition(() => router.refresh());
    }
  };

  const cur = PUBLIC_LOCALES.find((l) => l.code === current) ?? PUBLIC_LOCALES[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language / 언어"
        className="flex items-center gap-0.5 rounded-full px-2 py-1.5 text-sm font-semibold text-slate-600 hover:text-teal-700 disabled:opacity-50"
      >
        <GlobeIcon />
        <span className="text-xs font-bold">{cur.short}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Language"
          className="absolute right-0 top-full z-40 mt-1 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {PUBLIC_LOCALES.map((l) => {
            const active = l.code === current;
            return (
              <li key={l.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pick(l.code)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-sm ${
                    active ? "font-bold text-teal-700" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>{l.label}</span>
                  {active && <span aria-hidden>✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
