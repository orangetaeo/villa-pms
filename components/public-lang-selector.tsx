"use client";

// 공개·게스트 페이지 공용 언어 선택기 (5개 언어) — /p 제안·/g 게스트 전 화면 단일 컴포넌트.
//
// 배경: 같은 기능(p-locale 쿠키 + ?lang= 갱신 후 재렌더)이 LangSelector(/p)·HeaderLangSelect(/g)·
//   LangChips(2벌)로 4중 복제돼 있었고, 게스트 플로우 안에서 디자인이 드롭다운↔칩으로 갈렸다.
//   2026-06-27 헤더 지구본 드롭다운 1종으로 통일(테오 선택). docs/TRANSLATION-AUDIT-2026-06-27.md.
//
// 동작: ?lang= 파라미터가 언어 진실원천(resolvePublicLang: param > 쿠키 > ko). 선택 시
//   ① p-locale 쿠키(1년) 저장 → 재방문 유지 ② ?lang= 갱신 + router.refresh로 서버 재렌더.
import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  PUBLIC_LANGS,
  PUBLIC_LANG_NATIVE,
  PUBLIC_LOCALE_COOKIE,
  type PublicLang,
} from "@/lib/public-i18n";

export function PublicLangSelector({
  current,
  className = "",
}: {
  current: PublicLang;
  className?: string;
}) {
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
    // 쿠키 1년 — 재방문 시 같은 언어(param 미지정이어도 유지)
    document.cookie = `${PUBLIC_LOCALE_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", lang);
    router.replace(`${pathname}?${params.toString()}`);
    router.refresh();
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 transition-colors hover:text-teal-600 active:scale-95"
      >
        <span className="material-symbols-outlined text-[18px]">language</span>
        <span className="text-xs font-semibold">{PUBLIC_LANG_NATIVE[current]}</span>
        <span className="material-symbols-outlined text-[16px] text-slate-400">expand_more</span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Language"
          className="absolute right-0 top-full z-[60] mt-1.5 min-w-[140px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {PUBLIC_LANGS.map((lang) => (
            <li key={lang}>
              <button
                type="button"
                role="option"
                aria-selected={lang === current}
                onClick={() => select(lang)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  lang === current
                    ? "bg-teal-50/60 font-bold text-teal-600"
                    : "font-medium text-slate-700 hover:bg-slate-50"
                }`}
              >
                {PUBLIC_LANG_NATIVE[lang]}
                {lang === current && (
                  <span className="material-symbols-outlined text-[18px]">check</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
