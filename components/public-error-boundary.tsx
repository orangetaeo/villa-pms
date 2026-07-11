"use client";

// components/public-error-boundary.tsx — 소비자 포털(/g·/p) 공용 에러 바운더리 UI.
//   배경: 단일 컨테이너 순간 502/청크 로드 실패 시 React가 트리를 언마운트 → 백지(WSOD).
//   error.tsx가 없으면 게스트가 빈 흰 화면을 보고 이탈. 어떤 원인이든 "다시 시도"로 복구.
//   언어: p-locale 쿠키 기준(클라에서 document.cookie 파싱). 서버 i18n 불가(에러 바운더리=클라 전용).
//   문구는 공개 5언어 단일 사전(lib/public-i18n.ts)에서 참조 — 컴포넌트 내 리터럴 금지(단일 원천).
import { useEffect } from "react";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import {
  PUBLIC_LABELS,
  PUBLIC_LOCALE_COOKIE,
  isPublicLang,
  type PublicLang,
} from "@/lib/public-i18n";

function readLang(): PublicLang {
  if (typeof document === "undefined") return "ko";
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${PUBLIC_LOCALE_COOKIE}=([^;]+)`));
  const v = m?.[1];
  return isPublicLang(v) ? v : "ko";
}

export default function PublicErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 관측: 콘솔로만(외부 게스트 — 서버 로깅은 error.digest로 Next가 이미 수집)
    console.error("[public-error-boundary]", error?.message, error?.digest);
  }, [error]);

  const L = PUBLIC_LABELS[readLang()].errorBoundary;

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-8 text-center gap-5">
      <span className="flex items-center gap-1.5 opacity-80">
        <VillaGoMark className="h-6 w-auto" />
        <VillaGoWordmark className="text-lg" villa="text-slate-900" go="text-teal-600" />
      </span>
      <span className="material-symbols-outlined text-amber-500 text-5xl">error</span>
      <div className="space-y-2">
        <h1 className="text-lg font-extrabold text-slate-900">{L.title}</h1>
        <p className="text-sm text-slate-500 leading-relaxed max-w-xs">{L.desc}</p>
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="h-12 px-8 bg-teal-600 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
      >
        <span className="material-symbols-outlined text-[20px]">refresh</span>
        {L.retry}
      </button>
    </div>
  );
}
