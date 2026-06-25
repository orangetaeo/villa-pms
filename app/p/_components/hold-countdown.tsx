"use client";

import { useEffect, useState } from "react";
import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/** c3 완료 화면 카운트다운 배지 (#5 5개 언어) — holdExpiresAt 기준 실시간 */
export function HoldCountdown({ expiresAtIso, lang }: { expiresAtIso: string; lang: PublicLang }) {
  const t = PUBLIC_LABELS[lang].hold;
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const expiresAt = new Date(expiresAtIso).getTime();
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      const h = Math.floor(left / 3600);
      const m = Math.floor((left % 3600) / 60);
      const s = left % 60;
      setLabel(
        left === 0
          ? t.expired
          : `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} ${t.remainingSuffix}`
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAtIso, t]);

  return (
    <div className="flex items-center justify-center gap-2 bg-blue-50 text-blue-700 py-4 px-6 rounded-xl border border-blue-100">
      <span className="material-symbols-outlined text-blue-600 animate-pulse">timer</span>
      <span className="font-bold text-sm tabular-nums">{label ?? " "}</span>
    </div>
  );
}
