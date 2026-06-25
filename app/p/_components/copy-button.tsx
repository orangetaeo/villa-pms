"use client";

import { useState } from "react";
import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/** c3 입금 카드 계좌번호 복사 버튼 (#5 5개 언어) */
export function CopyButton({ text, lang }: { text: string; lang: PublicLang }) {
  const t = PUBLIC_LABELS[lang];
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 미지원 — 무시
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className="text-teal-600 text-xs font-bold hover:underline"
    >
      {copied ? t.copied : t.copy}
    </button>
  );
}
