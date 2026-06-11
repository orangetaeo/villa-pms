"use client";

import { useState } from "react";

/** c3 입금 카드 계좌번호 "복사" 버튼 (디자인 export 144~149행) */
export function CopyButton({ text }: { text: string }) {
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
      {copied ? "복사됨" : "복사"}
    </button>
  );
}
