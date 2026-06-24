"use client";

// 공급자 기간별 원가 편집기 (ADR-0014 후속) — 모바일 vi, teal. 기본요금 + 웃돈 기간 N의 원가만.
// 판매가·마진은 보이지 않음(운영자 영역). PATCH /api/villas/[id]/rate-periods/cost.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";

type Season = "LOW" | "HIGH" | "PEAK";
const SEASONS: Season[] = ["LOW", "HIGH", "PEAK"];

interface BaseFields {
  season: Season;
  supplierCostVnd: string;
  label: string;
}
export interface InitialRatePeriod {
  id: string;
  season: Season;
  startDate: string;
  endDate: string;
  supplierCostVnd: string;
  label: string;
}
interface PeriodRow extends InitialRatePeriod {
  localKey: string;
}

const digits = (v: string) => v.replace(/\D/g, "");
let counter = 0;
const localKey = () => `np${Date.now()}_${counter++}`;

export default function RatePeriodCostEditor({
  villaId,
  initialBase,
  initialPeriods,
}: {
  villaId: string;
  initialBase: BaseFields;
  initialPeriods: InitialRatePeriod[];
}) {
  const t = useTranslations("supplierRatePeriods");
  const router = useRouter();

  const [base, setBase] = useState<BaseFields>(initialBase);
  const [periods, setPeriods] = useState<PeriodRow[]>(
    initialPeriods.map((p) => ({ ...p, localKey: localKey() }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchPeriod(key: string, patch: Partial<PeriodRow>) {
    setPeriods((prev) => prev.map((p) => (p.localKey === key ? { ...p, ...patch } : p)));
  }
  function addPeriod() {
    setPeriods((prev) => [
      ...prev,
      { localKey: localKey(), id: "", season: "PEAK", startDate: "", endDate: "", supplierCostVnd: "", label: "" },
    ]);
  }
  function removePeriod(key: string) {
    setPeriods((prev) => prev.filter((p) => p.localKey !== key));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    // 기본요금 원가 필수
    if (!base.supplierCostVnd) {
      setError(t("baseCostRequired"));
      setSaving(false);
      return;
    }
    // 기간: 날짜·원가 모두 있어야 전송
    for (const p of periods) {
      if (!p.startDate || !p.endDate || !p.supplierCostVnd) {
        setError(t("periodIncomplete"));
        setSaving(false);
        return;
      }
    }
    const body = {
      base: { season: base.season, supplierCostVnd: base.supplierCostVnd, label: base.label.trim() || null },
      periods: periods.map((p) => ({
        ...(p.id ? { id: p.id } : {}),
        season: p.season,
        startDate: p.startDate,
        endDate: p.endDate,
        supplierCostVnd: p.supplierCostVnd,
        label: p.label.trim() || null,
      })),
    };
    try {
      const res = await fetch(`/api/villas/${villaId}/rate-periods/cost`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(res.status === 400 ? t("invalid") : t("saveError"));
        setSaving(false);
        return;
      }
      router.push(`/my-villas/${villaId}`);
      router.refresh();
    } catch {
      setError(t("saveError"));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-28 pt-5">
      <p className="text-sm text-neutral-500">{t("intro")}</p>

      {/* 기본요금 (비수기 기준) */}
      <div className="rounded-2xl border-2 border-teal-100 bg-teal-50/40 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-teal-600">home</span>
          <span className="font-bold text-neutral-800">{t("baseTitle")}</span>
        </div>
        <p className="mb-2 text-xs text-neutral-500">{t("baseHint")}</p>
        <CostInput
          value={base.supplierCostVnd}
          onChange={(d) => setBase((b) => ({ ...b, supplierCostVnd: d }))}
          label={t("cost")}
        />
      </div>

      {/* 웃돈 기간 */}
      <div className="space-y-3">
        {periods.map((p, i) => (
          <div key={p.localKey} className="rounded-2xl border-2 border-neutral-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-xs font-black text-teal-700">
                  {i + 1}
                </span>
                <input
                  type="text"
                  value={p.label}
                  onChange={(e) => patchPeriod(p.localKey, { label: e.target.value })}
                  placeholder={t("labelPlaceholder")}
                  maxLength={60}
                  aria-label={t("periodLabel")}
                  className="w-36 border-b border-neutral-200 bg-transparent text-sm font-semibold text-neutral-800 outline-none focus:border-teal-500"
                />
              </div>
              <button
                type="button"
                onClick={() => removePeriod(p.localKey)}
                aria-label={t("removePeriod")}
                className="text-red-500 active:opacity-60"
              >
                <span className="material-symbols-outlined">delete</span>
              </button>
            </div>
            {/* 시즌 */}
            <div className="mb-3 flex gap-2">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => patchPeriod(p.localKey, { season: s })}
                  className={`flex-1 rounded-lg py-2 text-xs font-bold transition-colors ${
                    p.season === s ? "bg-teal-600 text-white" : "border border-neutral-200 bg-white text-neutral-500"
                  }`}
                >
                  {t(`seasons.${s}`)}
                </button>
              ))}
            </div>
            {/* 날짜 */}
            <div className="mb-3 flex items-center gap-2">
              <input
                type="date"
                value={p.startDate}
                onChange={(e) => patchPeriod(p.localKey, { startDate: e.target.value })}
                aria-label={t("startDate")}
                className="flex-1 rounded-lg border border-neutral-200 px-2 py-2 text-sm text-neutral-700 tabular-nums"
              />
              <span className="text-neutral-400">~</span>
              <input
                type="date"
                value={p.endDate}
                onChange={(e) => patchPeriod(p.localKey, { endDate: e.target.value })}
                aria-label={t("endDate")}
                className="flex-1 rounded-lg border border-neutral-200 px-2 py-2 text-sm text-neutral-700 tabular-nums"
              />
            </div>
            <CostInput
              value={p.supplierCostVnd}
              onChange={(d) => patchPeriod(p.localKey, { supplierCostVnd: d })}
              label={t("cost")}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={addPeriod}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-200 font-semibold text-neutral-500 active:bg-neutral-50"
        >
          <span className="material-symbols-outlined">add</span>
          {t("addPeriod")}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 text-white shadow-lg shadow-teal-600/20 transition-transform active:scale-95 disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-base">save</span>
          <span className="font-bold">{saving ? t("saving") : t("save")}</span>
        </button>
      </div>
    </div>
  );
}

function CostInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (digits: string) => void;
  label: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-neutral-500">{label}</label>
      <div className="flex items-center rounded-xl border-2 border-neutral-100 bg-white px-3 focus-within:border-teal-400">
        <input
          type="text"
          inputMode="numeric"
          value={value ? formatVnd(value) : ""}
          onChange={(e) => onChange(digits(e.target.value))}
          aria-label={label}
          className="h-12 flex-1 bg-transparent text-right text-lg font-bold text-neutral-800 tabular-nums outline-none"
        />
        <span className="ml-1 text-base font-bold text-neutral-400">₫</span>
      </div>
    </div>
  );
}
