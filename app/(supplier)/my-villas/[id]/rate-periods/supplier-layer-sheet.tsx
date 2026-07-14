"use client";

// 공급자 기간 추가·수정 바텀시트 (rate-calendar-ux · A10) — 라이트 vi 모바일.
//   mode="add"    : 날짜(DateField)·시즌·이름·원가·자기판매가·프리미엄 → 기간 1개 추가
//   mode="edit"   : 위 + 삭제. base(isBase)는 날짜/이름 잠금(연중 기본요금).
//   mode="basket" : 날짜는 선택 바구니가 결정(시트엔 없음) → 시즌·이름·원가만. 선택 밤 수 표시.
// ★ 마진 비공개: 원가·자기판매가만. 운영자 Net/소비자가/마진 필드 없음.
import { useTranslations } from "next-intl";
import { DateField } from "@/components/date-field";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";
import { SEASON_COLOR, SEASON_LIST, digits, type SupplierLayer } from "./supplier-calendar-lib";

export type SheetMode = "add" | "edit" | "basket";

export default function SupplierLayerSheet({
  mode,
  layer,
  nightsSelected,
  error,
  onChange,
  onConfirm,
  onDelete,
  onCancel,
}: {
  mode: SheetMode;
  layer: SupplierLayer;
  /** basket 모드에서 선택된 총 밤 수(표시용) */
  nightsSelected?: number;
  error?: string | null;
  onChange: (l: SupplierLayer) => void;
  onConfirm: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("supplierRatePeriods");
  const isBase = layer.isBase;
  const showDates = mode !== "basket" && !isBase;
  const showSaleFields = Boolean(layer.ownSaleVnd) || Boolean(layer.premiumOwnSaleVnd);
  const title = isBase ? t("cal.editBaseTitle") : mode === "add" ? t("cal.addTitle") : mode === "basket" ? t("cal.addTitle") : t("cal.editTitle");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        className="max-h-[90dvh] w-full max-w-[420px] overflow-y-auto rounded-t-3xl bg-white pb-[max(24px,env(safe-area-inset-bottom))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-neutral-200" />
        <div className="flex items-center justify-between px-5 pb-1 pt-3">
          <h2 className="text-base font-bold text-neutral-800">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("cal.cancel")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 active:bg-neutral-100"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4 px-5 pt-2">
          {mode === "basket" && (
            <p className="rounded-xl bg-teal-50 px-3 py-2.5 text-sm font-semibold text-teal-700">
              {t("cal.selectedCount", { n: nightsSelected ?? 0 })}
            </p>
          )}

          {/* 시즌 */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-neutral-500">{t("cal.season")}</label>
            <div className="grid grid-cols-4 gap-1.5">
              {SEASON_LIST.map((s) => {
                const on = layer.season === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onChange({ ...layer, season: s })}
                    className="rounded-lg py-2 text-[11px] font-bold leading-tight transition-colors"
                    style={
                      on
                        ? { background: SEASON_COLOR[s], color: "#fff" }
                        : { background: "#fff", color: "#64748b", border: "1px solid #e5e7eb" }
                    }
                  >
                    {t(`seasons.${s}`)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 이름 (base 제외) */}
          {!isBase && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-neutral-500">{t("periodLabel")}</label>
              <input
                type="text"
                value={layer.label}
                onChange={(e) => onChange({ ...layer, label: e.target.value })}
                placeholder={t("labelPlaceholder")}
                maxLength={60}
                aria-label={t("periodLabel")}
                className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-800 outline-none focus:border-teal-500"
              />
            </div>
          )}

          {/* 날짜 (add/edit 비-base) */}
          {showDates && (
            <div className="flex items-center gap-2">
              <DateField
                value={layer.start}
                onChange={(e) => onChange({ ...layer, start: e.target.value })}
                aria-label={t("startDate")}
                placeholder={t("datePlaceholder")}
                wrapperClassName="flex-1"
                className="h-12 rounded-xl border border-neutral-200 px-3 text-sm text-neutral-700 tabular-nums"
              />
              <span className="text-neutral-400">~</span>
              <DateField
                value={layer.end}
                onChange={(e) => onChange({ ...layer, end: e.target.value })}
                aria-label={t("endDate")}
                placeholder={t("datePlaceholder")}
                wrapperClassName="flex-1"
                className="h-12 rounded-xl border border-neutral-200 px-3 text-sm text-neutral-700 tabular-nums"
              />
            </div>
          )}

          {/* 원가 (필수) */}
          <CostInput
            value={layer.supplierCostVnd}
            onChange={(d) => onChange({ ...layer, supplierCostVnd: d })}
            label={t("cost")}
          />

          {/* 자기 판매가 (선택) */}
          <CostInput
            value={layer.ownSaleVnd}
            onChange={(d) => onChange({ ...layer, ownSaleVnd: d })}
            label={t("salePrice")}
            hint={t("salePriceHint")}
            variant="sale"
          />

          {/* 프리미엄(주말·공휴일) */}
          <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3">
            <button
              type="button"
              role="switch"
              aria-checked={layer.premiumOpen}
              onClick={() => onChange({ ...layer, premiumOpen: !layer.premiumOpen })}
              className="flex w-full items-center justify-between gap-2"
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-amber-700">
                <span className="material-symbols-outlined text-[18px]">local_fire_department</span>
                {t("premiumToggle")}
              </span>
              <span
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${layer.premiumOpen ? "bg-amber-400" : "bg-neutral-300"}`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${layer.premiumOpen ? "translate-x-5" : ""}`}
                />
              </span>
            </button>
            {layer.premiumOpen && (
              <div className="mt-3 space-y-3">
                <CostInput
                  value={layer.premiumCostVnd}
                  onChange={(d) => onChange({ ...layer, premiumCostVnd: d })}
                  label={t("premiumCost")}
                  variant="premium"
                />
                {showSaleFields && (
                  <CostInput
                    value={layer.premiumOwnSaleVnd}
                    onChange={(d) => onChange({ ...layer, premiumOwnSaleVnd: d })}
                    label={t("premiumSalePrice")}
                    variant="premium"
                  />
                )}
                <p className="text-[11px] leading-snug text-amber-700/70">{t("premiumEmptyHint")}</p>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="mx-5 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">
            {error}
          </p>
        )}

        {/* 액션 바 */}
        <div className="mt-5 flex items-center gap-2 px-5">
          {mode === "edit" && !isBase && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t("cal.delete")}
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border border-red-200 text-red-500 active:bg-red-50"
            >
              <span className="material-symbols-outlined">delete</span>
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className="flex h-[52px] flex-1 items-center justify-center rounded-2xl bg-teal-600 text-base font-bold text-white shadow-lg shadow-teal-600/20 active:scale-[.99]"
          >
            {mode === "edit" ? t("cal.done") : t("cal.add")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 금액 입력 (라이트 · variant별 색) — rate-period-cost-editor CostInput 계승 ──
function CostInput({
  value,
  onChange,
  label,
  hint,
  variant = "cost",
}: {
  value: string;
  onChange: (d: string) => void;
  label: string;
  hint?: string;
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
        <span className={`ml-1 text-base font-bold ${isPremium ? "text-amber-500" : isSale ? "text-teal-500" : "text-neutral-400"}`}>
          ₫
        </span>
      </div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-neutral-400">{hint}</p>}
    </div>
  );
}
