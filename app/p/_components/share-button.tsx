"use client";

import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/** c1 헤더 공유 버튼 (#5 5개 언어) — Web Share API, 미지원 시 URL 복사 */
export function ShareButton({ title, lang }: { title: string; lang: PublicLang }) {
  const t = PUBLIC_LABELS[lang];
  const onShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      alert(t.shareCopied);
    } catch {
      // 사용자 취소 등 — 무시
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      aria-label={t.share}
      className="text-teal-600 hover:bg-neutral-50 transition-colors duration-200 p-2 rounded-full"
    >
      <span className="material-symbols-outlined">share</span>
    </button>
  );
}
