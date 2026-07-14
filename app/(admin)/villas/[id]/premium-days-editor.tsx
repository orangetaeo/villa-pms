"use client";

// 프리미엄 요일 설정 (ADR-0042) — 다크 ADMIN, STAFF 전용 카드.
// finance 권한자는 요금 캘린더 범례 "● 프리미엄일"에서 인라인 편집하므로(중복 방지) 이 카드는
// !showFinance(STAFF)일 때만 렌더된다(page.tsx 게이트). PATCH /api/villas/[id]/info { premiumDays }.
// "어느 박이 프리미엄인가"의 요일 축(비밀 아님) — 실제 프리미엄 금액·판매가·마진은 이 화면에 없다(누수 0).
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
        // premiumDays만 전송(요일 축) — 판매가·마진 등 finance 필드는 페이로드에 없음. 정렬·중복제거는 서버.
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
        {/* 7열 그리드 — 좁은 화면에서도 요일 7개가 항상 한 줄 */}
        <div className="grid max-w-xs grid-cols-7 gap-1.5">
          {DAY_INDEXES.map((d) => {
            const on = days.has(d);
            const weekend = d === 0 || d === 6;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(d)}
                className={`aspect-square w-full max-w-11 rounded-lg text-sm font-bold flex items-center justify-center transition-all ${
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
