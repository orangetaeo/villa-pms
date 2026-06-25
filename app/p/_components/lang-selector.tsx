"use client";

// 공개 페이지 언어 선택기 (#5) — 5개 언어. 선택 시 p-locale 쿠키 저장 + ?lang= 갱신(서버 재렌더).
import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  PUBLIC_LANGS,
  PUBLIC_LANG_NATIVE,
  PUBLIC_LOCALE_COOKIE,
  type PublicLang,
} from "@/lib/public-i18n";

export function LangSelector({ current }: { current: PublicLang }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const select = (lang: PublicLang) => {
    setOpen(false);
    if (lang === current) return;
    // 쿠키 1년 보존 — 재방문 시 같은 언어 (param 미지정이어도 유지)
    document.cookie = `${PUBLIC_LOCALE_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", lang);
    router.replace(`${pathname}?${params.toString()}`);
    router.refresh();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Language"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 text-neutral-500 hover:text-teal-600 transition-colors p-2 rounded-full hover:bg-neutral-50"
      >
        <span className="material-symbols-outlined text-[20px]">language</span>
        <span className="text-xs font-semibold">{PUBLIC_LANG_NATIVE[current]}</span>
        <span className="material-symbols-outlined text-[16px]">expand_more</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 mt-1 w-32 bg-white border border-neutral-200 rounded-lg shadow-lg overflow-hidden z-[60] py-1"
        >
          {PUBLIC_LANGS.map((lang) => (
            <li key={lang}>
              <button
                type="button"
                role="option"
                aria-selected={lang === current}
                onClick={() => select(lang)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  lang === current
                    ? "bg-teal-50 text-teal-700 font-semibold"
                    : "text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {PUBLIC_LANG_NATIVE[lang]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
