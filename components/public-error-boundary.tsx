"use client";

// components/public-error-boundary.tsx — 소비자 포털(/g·/p) 공용 에러 바운더리 UI.
//   배경: 단일 컨테이너 순간 502/청크 로드 실패 시 React가 트리를 언마운트 → 백지(WSOD).
//   error.tsx가 없으면 게스트가 빈 흰 화면을 보고 이탈. 어떤 원인이든 "다시 시도"로 복구.
//   언어: p-locale 쿠키 기준(클라에서 document.cookie 파싱). 서버 i18n 불가(에러 바운더리=클라 전용).
import { useEffect } from "react";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

type Lang = "ko" | "en" | "ru" | "zh" | "vi";

const LABELS: Record<Lang, { title: string; desc: string; retry: string }> = {
  ko: {
    title: "일시적인 문제가 발생했어요",
    desc: "잠시 후 다시 시도해 주세요. 문제가 계속되면 예약하신 여행사로 문의해 주세요.",
    retry: "다시 시도",
  },
  en: {
    title: "Something went wrong",
    desc: "Please try again in a moment. If it keeps happening, contact your travel agency.",
    retry: "Try again",
  },
  ru: {
    title: "Произошла временная ошибка",
    desc: "Пожалуйста, попробуйте ещё раз через минуту. Если ошибка повторяется, свяжитесь с турагентством.",
    retry: "Повторить",
  },
  zh: {
    title: "出现了暂时的问题",
    desc: "请稍后重试。如果问题持续，请联系您的旅行社。",
    retry: "重试",
  },
  vi: {
    title: "Đã xảy ra sự cố tạm thời",
    desc: "Vui lòng thử lại sau giây lát. Nếu vẫn lỗi, hãy liên hệ công ty du lịch của bạn.",
    retry: "Thử lại",
  },
};

function readLang(): Lang {
  if (typeof document === "undefined") return "ko";
  const m = document.cookie.match(/(?:^|;\s*)p-locale=([^;]+)/);
  const v = m?.[1] as Lang | undefined;
  return v && v in LABELS ? v : "ko";
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

  const L = LABELS[readLang()];

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
