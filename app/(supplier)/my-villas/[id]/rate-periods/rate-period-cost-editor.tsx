"use client";

// 공급자 기간별 원가·판매가 편집기 (ADR-0014 + ADR-0021 §7 T10.6) — 모바일 vi, teal.
//   - 원가(supplierCostVnd, 중립색): 우리가 매입하는 가격(필수).
//   - 판매가(supplierSalePriceVnd, teal 강조): 공급자가 자기 고객에게 받을 정가(선택, 판매 링크 자동 견적용).
// 운영자 재판매 판매가(salePriceVnd/KRW)·마진은 절대 보이지 않음(사업원칙 2). PATCH /api/villas/[id]/rate-periods/cost.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";

type Season = "LOW" | "HIGH" | "PEAK";
const SEASONS: Season[] = ["LOW", "HIGH", "PEAK"];

interface BaseFields {
  season: Season;
  supplierCostVnd: string;
  supplierSalePriceVnd: string; // 공급자 자기 판매가(선택)
  label: string;
}
export interface InitialRatePeriod {
  id: string;
  season: Season;
  startDate: string;
  endDate: string;
  supplierCostVnd: string;
  supplierSalePriceVnd: string; // 공급자 자기 판매가(선택)
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
      { localKey: localKey(), id: "", season: "PEAK", startDate: "", endDate: "", supplierCostVnd: "", supplierSalePriceVnd: "", label: "" },
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
      base: {
        season: base.season,
        supplierCostVnd: base.supplierCostVnd,
        supplierSalePriceVnd: base.supplierSalePriceVnd || null, // 빈값 = 미설정(null)
        label: base.label.trim() || null,
      },
      periods: periods.map((p) => ({
        ...(p.id ? { id: p.id } : {}),
        season: p.season,
        startDate: p.startDate,
        endDate: p.endDate,
        supplierCostVnd: p.supplierCostVnd,
        supplierSalePriceVnd: p.supplierSalePriceVnd || null, // 빈값 = 미설정(null)
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
        <div className="mt-3">
          <CostInput
            value={base.supplierSalePriceVnd}
            onChange={(d) => setBase((b) => ({ ...b, supplierSalePriceVnd: d }))}
            label={t("salePrice")}
            hint={t("salePriceHint")}
            variant="sale"
          />
        </div>
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
            <div className="mt-3">
              <CostInput
                value={p.supplierSalePriceVnd}
                onChange={(d) => patchPeriod(p.localKey, { supplierSalePriceVnd: d })}
                label={t("salePrice")}
                hint={t("salePriceHint")}
                variant="sale"
              />
            </div>
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
  hint,
  variant = "cost",
}: {
  value: string;
  onChange: (digits: string) => void;
  label: string;
  hint?: string;
  /** cost = 중립 회색(원가), sale = teal 강조(공급자 자기 판매가) */
  variant?: "cost" | "sale";
}) {
  const isSale = variant === "sale";
  return (
    <div>
      <label
        className={`mb-1 flex items-center gap-1 text-xs font-semibold ${
          isSale ? "text-teal-700" : "text-neutral-500"
        }`}
      >
        {isSale && <span className="material-symbols-outlined text-[15px]">sell</span>}
        {label}
      </label>
      <div
        className={`flex items-center rounded-xl border-2 px-3 ${
          isSale
            ? "border-teal-200 bg-teal-50/40 focus-within:border-teal-500"
            : "border-neutral-100 bg-white focus-within:border-teal-400"
        }`}
      >
        <input
          type="text"
          inputMode="numeric"
          value={value ? formatVnd(value) : ""}
          onChange={(e) => onChange(digits(e.target.value))}
          aria-label={label}
          className={`h-12 flex-1 bg-transparent text-right text-lg font-bold tabular-nums outline-none ${
            isSale ? "text-teal-800" : "text-neutral-800"
          }`}
        />
        <span className={`ml-1 text-base font-bold ${isSale ? "text-teal-500" : "text-neutral-400"}`}>
          ₫
        </span>
      </div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-neutral-400">{hint}</p>}
    </div>
  );
}
