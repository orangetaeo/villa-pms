"use client";

// 가격 입력 폼 — 원가+마진→판매가 자동제안 (rate-calendar-ux)
// 구 rate-period-editor(삭제됨) RateFieldsRow 흐름 승계. mode='admin'=3축(원가·Net·소비자·프리미엄),
//   mode='supplier'=원가만(Net/소비자/프리미엄 Net 미노출 — 누수 차단). 라벨은 상위 폼에서.
import { useTranslations } from "next-intl";
import type { MarginType } from "@prisma/client";
import { formatThousands } from "@/lib/format";
import type { CalendarMode } from "./types";
import { suggestKrw, suggestMarkupVnd, toDigits, withSuggestion, type PriceFormState } from "./price-suggest";

export default function PriceFields({
  mode,
  fields,
  fxVndPerKrw,
  onChange,
}: {
  mode: CalendarMode;
  fields: PriceFormState;
  fxVndPerKrw: number | null;
  onChange: (next: PriceFormState) => void;
}) {
  const tr = useTranslations("adminVillas.detail.rates");

  const patch = (p: Partial<PriceFormState>, resuggest = false) => {
    const next = { ...fields, ...p };
    onChange(resuggest ? withSuggestion(next, fxVndPerKrw) : next);
  };

  return (
    <div className="space-y-3">
      {/* 좁은 사이드 패널에 3열은 마진 칸이 뭉개짐 — 2열(원가·마진 / Net)로 배치 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* 원가 */}
        <Field label={tr("colCost")}>
          <NumInput
            value={fields.supplierCostVnd}
            onChange={(d) => patch({ supplierCostVnd: d }, true)}
            suffix="₫"
            ariaLabel={tr("colCost")}
          />
        </Field>

        {mode === "admin" && (
          <>
            {/* 마진 */}
            <Field label={tr("colMargin")}>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={
                    fields.marginType === "FIXED_VND"
                      ? fields.marginValue
                        ? formatThousands(fields.marginValue)
                        : ""
                      : fields.marginValue
                  }
                  onChange={(e) => patch({ marginValue: toDigits(e.target.value) }, true)}
                  aria-label={tr("colMargin")}
                  className="flex-1 min-w-0 h-10 bg-slate-900 border border-slate-700 rounded px-2 text-right text-xs text-slate-100 tabular-nums"
                />
                <MarginTypeSelect
                  value={fields.marginType}
                  onChange={(v) => patch({ marginType: v }, true)}
                  tr={tr}
                />
              </div>
            </Field>
            {/* Net VND */}
            <Field label={tr("colSaleVnd")}>
              <NumInput
                value={fields.salePriceVnd}
                onChange={(d) => {
                  const krw = suggestKrw(d, fxVndPerKrw);
                  const consumerVnd = suggestMarkupVnd(d, fields.consumerMarginType, fields.consumerMarginValue);
                  const consumerKrw = suggestKrw(consumerVnd, fxVndPerKrw);
                  patch({
                    salePriceVnd: d,
                    ...(krw !== null ? { salePriceKrw: krw } : {}),
                    consumerSalePriceVnd: consumerVnd,
                    ...(consumerKrw !== null ? { consumerSalePriceKrw: consumerKrw } : {}),
                  });
                }}
                suffix="₫"
                ariaLabel={tr("colSaleVnd")}
              />
            </Field>
          </>
        )}
      </div>

      {mode === "admin" && (
        <>
          {/* 소비자 직판가 (ADR-0031) */}
          <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/[0.04] p-3">
            <p className="text-[10px] font-bold text-indigo-300 mb-2 uppercase tracking-wider">
              {tr("consumerSection")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={tr("colConsumerMargin")}>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={
                      fields.consumerMarginType === "FIXED_VND"
                        ? fields.consumerMarginValue
                          ? formatThousands(fields.consumerMarginValue)
                          : ""
                        : fields.consumerMarginValue
                    }
                    onChange={(e) => patch({ consumerMarginValue: toDigits(e.target.value) }, true)}
                    aria-label={tr("colConsumerMargin")}
                    className="flex-1 min-w-0 h-10 bg-slate-900 border border-slate-700 rounded px-2 text-right text-xs text-slate-100 tabular-nums"
                  />
                  <MarginTypeSelect
                    value={fields.consumerMarginType}
                    onChange={(v) => patch({ consumerMarginType: v }, true)}
                    tr={tr}
                  />
                </div>
              </Field>
              <Field label={tr("colConsumerVnd")}>
                <NumInput
                  value={fields.consumerSalePriceVnd}
                  onChange={(d) => {
                    const krw = suggestKrw(d, fxVndPerKrw);
                    patch({ consumerSalePriceVnd: d, ...(krw !== null ? { consumerSalePriceKrw: krw } : {}) });
                  }}
                  suffix="₫"
                  ariaLabel={tr("colConsumerVnd")}
                />
              </Field>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">{tr("consumerHint")}</p>
          </div>

          {/* 프리미엄 요금 (ADR-0042) */}
          <div className="rounded-lg border border-fuchsia-500/25 bg-fuchsia-500/[0.04] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-fuchsia-300 uppercase tracking-wider">
                <span className="material-symbols-outlined text-sm">weekend</span>
                {tr("premiumSection")}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={fields.premiumEnabled}
                aria-label={tr("premiumSection")}
                onClick={() => patch({ premiumEnabled: !fields.premiumEnabled }, true)}
                className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${fields.premiumEnabled ? "bg-fuchsia-500" : "bg-slate-700"}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${fields.premiumEnabled ? "translate-x-5" : ""}`}
                />
              </button>
            </div>
            {fields.premiumEnabled && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={tr("colPremiumCost")}>
                  <NumInput
                    value={fields.premiumSupplierCostVnd}
                    onChange={(d) => patch({ premiumSupplierCostVnd: d }, true)}
                    suffix="₫"
                    ariaLabel={tr("colPremiumCost")}
                  />
                </Field>
                <Field label={tr("colPremiumSaleVnd")}>
                  <NumInput
                    value={fields.premiumSalePriceVnd}
                    onChange={(d) => {
                      const krw = suggestKrw(d, fxVndPerKrw);
                      const consumerVnd = suggestMarkupVnd(d, fields.consumerMarginType, fields.consumerMarginValue);
                      const consumerKrw = suggestKrw(consumerVnd, fxVndPerKrw);
                      patch({
                        premiumSalePriceVnd: d,
                        ...(krw !== null ? { premiumSalePriceKrw: krw } : {}),
                        premiumConsumerSalePriceVnd: consumerVnd,
                        ...(consumerKrw !== null ? { premiumConsumerSalePriceKrw: consumerKrw } : {}),
                      });
                    }}
                    suffix="₫"
                    ariaLabel={tr("colPremiumSaleVnd")}
                  />
                </Field>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MarginTypeSelect({
  value,
  onChange,
  tr,
}: {
  value: MarginType;
  onChange: (v: MarginType) => void;
  tr: ReturnType<typeof useTranslations>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MarginType)}
      aria-label={tr("colMargin")}
      className="h-10 w-[4.25rem] shrink-0 bg-slate-900 border border-slate-700 rounded px-1.5 text-[11px] text-slate-100"
    >
      <option value="PERCENT">{tr("percent")}</option>
      <option value="FIXED_VND">{tr("fixed")}</option>
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider whitespace-nowrap">
        {label}
      </label>
      {children}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  suffix,
  ariaLabel,
}: {
  value: string;
  onChange: (digits: string) => void;
  suffix: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center bg-slate-900 border border-slate-700 rounded h-10 px-3 focus-within:ring-1 focus-within:ring-blue-500">
      <input
        type="text"
        inputMode="numeric"
        value={value ? formatThousands(value) : ""}
        onChange={(e) => onChange(toDigits(e.target.value))}
        aria-label={ariaLabel}
        className="flex-1 w-full bg-transparent border-0 focus:ring-0 text-right text-xs text-slate-100 tabular-nums p-0 min-w-0"
      />
      <span className="text-[11px] text-slate-500 ml-0.5">{suffix}</span>
    </div>
  );
}
