"use client";

// 프리미엄 요일 설정 (ADR-0042) — 다크 ADMIN. 요일 칩 토글(일~토, getUTCDay 0~6).
// PATCH /api/villas/[id]/info { premiumDays }. 가격이 아니라 "어느 박이 프리미엄인가"의 요일 축(비밀 아님).
// 실제 프리미엄 금액은 요율표(rate-period-editor)의 "프리미엄 요금" 토글에서 입력. 공휴일은 설정→공휴일 관리.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import CollapsibleCard from "@/components/admin/collapsible-card";

// getUTCDay 인덱스 0=일 … 6=토 (숙박일 @db.Date UTC 자정 기준 — lib/pricing과 동일 축)
const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;

export default function PremiumDaysEditor({
  villaId,
  initialDays,
}: {
  villaId: string;
  initialDays: number[];
}) {
  const t = useTranslations("adminVillas.detail.premiumDays");
  const router = useRouter();

  const [days, setDays] = useState<Set<number>>(() => new Set(initialDays));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
    setMessage(null);
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/villas/${villaId}/info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // 빈 배열 허용(공휴일만 프리미엄) — 정렬·중복제거는 서버 담당
        body: JSON.stringify({ premiumDays: [...days] }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("saveError") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard
      title={t("title")}
      icon="weekend"
      action={
        <>
          {message && (
            <span
              role="status"
              className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
            >
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-admin-primary hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold whitespace-nowrap flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            {saving ? t("saving") : t("save")}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[11px] text-slate-500 leading-relaxed">{t("hint")}</p>
        <div className="flex flex-wrap gap-2">
          {DAY_INDEXES.map((d) => {
            const on = days.has(d);
            // 주말(일·토)은 시각적 강조색만 다르게 — 판정 로직은 동일
            const weekend = d === 0 || d === 6;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(d)}
                className={`w-11 h-11 rounded-lg text-sm font-bold flex items-center justify-center transition-all ${
                  on
                    ? "bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/40"
                    : `bg-slate-900/60 border border-slate-700 hover:border-slate-500 ${weekend ? "text-slate-300" : "text-slate-400"}`
                }`}
              >
                {t(`weekdays.${d}` as "weekdays.0")}
              </button>
            );
          })}
        </div>
      </div>
    </CollapsibleCard>
  );
}
