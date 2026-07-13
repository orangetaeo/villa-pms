"use client";

// 공급자 기간별 원가·판매가 편집기 (ADR-0014 + ADR-0021 §7 T10.6 + ADR-0042) — 모바일 vi, teal.
//   - 원가(supplierCostVnd, 중립색): 우리가 매입하는 가격(필수).
//   - 판매가(supplierSalePriceVnd, teal 강조): 공급자가 자기 고객에게 받을 정가(선택, 판매 링크 자동 견적용).
//   - 프리미엄(ADR-0042, amber 강조): 주말·공휴일 밤에 받는 웃돈. 요일 칩(villa.premiumDays) + 기간행 프리미엄 원가/자기판매가.
//     빈 칸이면 평일가 폴백(무중단). 프리미엄 요일은 /info, 프리미엄 원가는 /rate-periods/cost 로 저장.
// 운영자 재판매 판매가(salePriceVnd/KRW)·마진·프리미엄 Net은 절대 보이지 않음(사업원칙 2).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";
import { DateField } from "@/components/date-field";

type Season = "LOW" | "SHOULDER" | "HIGH" | "PEAK";
const SEASONS: Season[] = ["LOW", "SHOULDER", "HIGH", "PEAK"];
// getUTCDay 인덱스 0=일 … 6=토 (숙박일 @db.Date UTC 자정 기준 — lib/pricing과 동일 축)
const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;

interface BaseFields {
  season: Season;
  supplierCostVnd: string;
  supplierSalePriceVnd: string; // 공급자 자기 판매가(선택)
  premiumSupplierCostVnd: string; // ADR-0042 프리미엄 박 원가(선택)
  premiumSupplierSalePriceVnd: string; // ADR-0042 프리미엄 박 자기 판매가(선택)
  label: string;
}
export interface InitialRatePeriod {
  id: string;
  season: Season;
  startDate: string;
  endDate: string;
  supplierCostVnd: string;
  supplierSalePriceVnd: string; // 공급자 자기 판매가(선택)
  premiumSupplierCostVnd: string; // ADR-0042 프리미엄 박 원가(선택)
  premiumSupplierSalePriceVnd: string; // ADR-0042 프리미엄 박 자기 판매가(선택)
  label: string;
}
interface PeriodRow extends InitialRatePeriod {
  localKey: string;
  premiumOpen: boolean; // "주말·공휴일 요금" 토글 상태
}

const digits = (v: string) => v.replace(/\D/g, "");
let counter = 0;
const localKey = () => `np${Date.now()}_${counter++}`;
const hasPremium = (r: { premiumSupplierCostVnd: string; premiumSupplierSalePriceVnd: string }) =>
  Boolean(r.premiumSupplierCostVnd || r.premiumSupplierSalePriceVnd);

export default function RatePeriodCostEditor({
  villaId,
  initialBase,
  initialPeriods,
  initialPremiumDays,
}: {
  villaId: string;
  initialBase: BaseFields;
  initialPeriods: InitialRatePeriod[];
  initialPremiumDays: number[];
}) {
  const t = useTranslations("supplierRatePeriods");
  const router = useRouter();

  const [base, setBase] = useState<BaseFields>(initialBase);
  const [basePremiumOpen, setBasePremiumOpen] = useState(hasPremium(initialBase));
  const [days, setDays] = useState<Set<number>>(() => new Set(initialPremiumDays));
  const [periods, setPeriods] = useState<PeriodRow[]>(
    initialPeriods.map((p) => ({ ...p, localKey: localKey(), premiumOpen: hasPremium(p) }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // premiumDays 초기값(정렬 문자열) — 변경 시에만 /info PATCH (INFO 알림 소음 방지)
  const initialDaysKey = [...initialPremiumDays].sort((a, b) => a - b).join(",");

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
    setError(null);
  }
  function patchPeriod(key: string, patch: Partial<PeriodRow>) {
    setPeriods((prev) => prev.map((p) => (p.localKey === key ? { ...p, ...patch } : p)));
  }
  function addPeriod() {
    setPeriods((prev) => [
      ...prev,
      {
        localKey: localKey(), id: "", season: "PEAK", startDate: "", endDate: "",
        supplierCostVnd: "", supplierSalePriceVnd: "",
        premiumSupplierCostVnd: "", premiumSupplierSalePriceVnd: "", premiumOpen: false, label: "",
      },
    ]);
  }
  function removePeriod(key: string) {
    setPeriods((prev) => prev.filter((p) => p.localKey !== key));
  }

  // 토글 닫힘 = 프리미엄 미사용(null → 평일가 폴백). 열림이어도 빈 칸이면 null.
  const premiumOut = (open: boolean, cost: string, sale: string) => ({
    premiumSupplierCostVnd: open ? cost || null : null,
    premiumSupplierSalePriceVnd: open ? sale || null : null,
  });

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
        ...premiumOut(basePremiumOpen, base.premiumSupplierCostVnd, base.premiumSupplierSalePriceVnd),
        label: base.label.trim() || null,
      },
      periods: periods.map((p) => ({
        ...(p.id ? { id: p.id } : {}),
        season: p.season,
        startDate: p.startDate,
        endDate: p.endDate,
        supplierCostVnd: p.supplierCostVnd,
        supplierSalePriceVnd: p.supplierSalePriceVnd || null, // 빈값 = 미설정(null)
        ...premiumOut(p.premiumOpen, p.premiumSupplierCostVnd, p.premiumSupplierSalePriceVnd),
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
      // 프리미엄 요일이 바뀐 경우에만 /info PATCH (가격 아님 — 비밀 아님)
      const currentDaysKey = [...days].sort((a, b) => a - b).join(",");
      if (currentDaysKey !== initialDaysKey) {
        const dayRes = await fetch(`/api/villas/${villaId}/info`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ premiumDays: [...days] }),
        });
        if (!dayRes.ok) {
          setError(t("saveError"));
          setSaving(false);
          return;
        }
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

      {/* 프리미엄 요일 (villa 단위 — 어느 요일 밤이 웃돈인가) */}
      <div className="rounded-2xl border-2 border-amber-100 bg-amber-50/50 p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-500">weekend</span>
          <span className="font-bold text-neutral-800">{t("premiumDaysTitle")}</span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-neutral-500">{t("premiumDaysHint")}</p>
        {/* 7열 그리드 — 좁은 화면에서도 요일 7개가 항상 한 줄(칩이 폭에 맞게 축소, 최대 48px) */}
        <div className="grid max-w-xs grid-cols-7 gap-1.5">
          {DAY_INDEXES.map((d) => {
            const on = days.has(d);
            const weekend = d === 0 || d === 6;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={`flex aspect-square w-full max-w-12 items-center justify-center rounded-xl text-sm font-bold transition-all active:scale-95 ${
                  on
                    ? "bg-amber-400 text-white shadow-sm shadow-amber-400/30"
                    : `border-2 border-neutral-200 bg-white ${weekend ? "text-neutral-600" : "text-neutral-400"}`
                }`}
              >
                {t(`weekdays.${d}` as "weekdays.0")}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-neutral-400">{t("holidayNote")}</p>
      </div>

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
        <PremiumSection
          open={basePremiumOpen}
          onToggle={setBasePremiumOpen}
          cost={base.premiumSupplierCostVnd}
          onCost={(d) => setBase((b) => ({ ...b, premiumSupplierCostVnd: d }))}
          sale={base.premiumSupplierSalePriceVnd}
          onSale={(d) => setBase((b) => ({ ...b, premiumSupplierSalePriceVnd: d }))}
          showSale={Boolean(base.supplierSalePriceVnd) || Boolean(base.premiumSupplierSalePriceVnd)}
          t={t}
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
              <DateField
                value={p.startDate}
                onChange={(e) => patchPeriod(p.localKey, { startDate: e.target.value })}
                aria-label={t("startDate")}
                placeholder={t("datePlaceholder")}
                placeholderClassName="text-neutral-400"
                wrapperClassName="flex-1"
                className="w-full rounded-lg border border-neutral-200 px-2 py-2 text-sm text-neutral-700 tabular-nums"
              />
              <span className="text-neutral-400">~</span>
              <DateField
                value={p.endDate}
                onChange={(e) => patchPeriod(p.localKey, { endDate: e.target.value })}
                aria-label={t("endDate")}
                placeholder={t("datePlaceholder")}
                placeholderClassName="text-neutral-400"
                wrapperClassName="flex-1"
                className="w-full rounded-lg border border-neutral-200 px-2 py-2 text-sm text-neutral-700 tabular-nums"
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
            <PremiumSection
              open={p.premiumOpen}
              onToggle={(v) => patchPeriod(p.localKey, { premiumOpen: v })}
              cost={p.premiumSupplierCostVnd}
              onCost={(d) => patchPeriod(p.localKey, { premiumSupplierCostVnd: d })}
              sale={p.premiumSupplierSalePriceVnd}
              onSale={(d) => patchPeriod(p.localKey, { premiumSupplierSalePriceVnd: d })}
              showSale={Boolean(p.supplierSalePriceVnd) || Boolean(p.premiumSupplierSalePriceVnd)}
              t={t}
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

// 프리미엄(주말·공휴일) 요금 토글 블록 — amber. 열면 프리미엄 원가(+자기판매가) 노출, 빈 칸이면 평일가 폴백.
function PremiumSection({
  open,
  onToggle,
  cost,
  onCost,
  sale,
  onSale,
  showSale,
  t,
}: {
  open: boolean;
  onToggle: (v: boolean) => void;
  cost: string;
  onCost: (digits: string) => void;
  sale: string;
  onSale: (digits: string) => void;
  /** 자기 판매가를 이미 쓰는 화면이면 프리미엄 자기판매가 칸도 노출 */
  showSale: boolean;
  t: ReturnType<typeof useTranslations<"supplierRatePeriods">>;
}) {
  return (
    <div className="mt-3 rounded-xl border-2 border-amber-100 bg-amber-50/40 p-3">
      <button
        type="button"
        role="switch"
        aria-checked={open}
        onClick={() => onToggle(!open)}
        className="flex w-full items-center justify-between gap-2"
      >
        <span className="flex items-center gap-1.5 text-sm font-bold text-amber-700">
          <span className="material-symbols-outlined text-[18px]">local_fire_department</span>
          {t("premiumToggle")}
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${open ? "bg-amber-400" : "bg-neutral-300"}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${open ? "translate-x-5" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <CostInput value={cost} onChange={onCost} label={t("premiumCost")} variant="premium" />
          {showSale && (
            <CostInput value={sale} onChange={onSale} label={t("premiumSalePrice")} variant="premium" />
          )}
          <p className="text-[11px] leading-snug text-amber-700/70">{t("premiumEmptyHint")}</p>
        </div>
      )}
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
  /** cost = 중립 회색(원가), sale = teal(공급자 자기 판매가), premium = amber(주말·공휴일 웃돈) */
  variant?: "cost" | "sale" | "premium";
}) {
  const isSale = variant === "sale";
  const isPremium = variant === "premium";
  return (
    <div>
      <label
        className={`mb-1 flex items-center gap-1 text-xs font-semibold ${
          isPremium ? "text-amber-700" : isSale ? "text-teal-700" : "text-neutral-500"
        }`}
      >
        {isSale && <span className="material-symbols-outlined text-[15px]">sell</span>}
        {label}
      </label>
      <div
        className={`flex items-center rounded-xl border-2 px-3 ${
          isPremium
            ? "border-amber-200 bg-white focus-within:border-amber-400"
            : isSale
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
            isPremium ? "text-amber-800" : isSale ? "text-teal-800" : "text-neutral-800"
          }`}
        />
        <span
          className={`ml-1 text-base font-bold ${
            isPremium ? "text-amber-500" : isSale ? "text-teal-500" : "text-neutral-400"
          }`}
        >
          ₫
        </span>
      </div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-neutral-400">{hint}</p>}
    </div>
  );
}
