"use client";

// 레이어 편집 시트 — 날짜·라벨·시즌·가격 수정 → PATCH layers/[layerId] (rate-calendar-ux, v1 필수)
// 목업에 없던 v1 필수 기능. base 행은 날짜 잠금(서버 400 대칭 — 여기선 날짜 입력 비활성).
import { useTranslations } from "next-intl";
import { DateField } from "@/components/date-field";
import type { CalendarMode, Season } from "./types";
import { SEASON_LIST, SEASON_VAR } from "./types";
import type { PriceFormState } from "./price-suggest";
import PriceFields from "./price-fields";

export interface EditState {
  layerId: string;
  isBase: boolean;
  start: string;
  end: string;
  form: PriceFormState;
  err: boolean;
}

export default function LayerEditSheet({
  mode,
  state,
  fxVndPerKrw,
  pending,
  onChange,
  onSave,
  onCancel,
}: {
  mode: CalendarMode;
  state: EditState;
  fxVndPerKrw: number | null;
  pending: boolean;
  onChange: (s: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("rateCalendar");
  const tr = useTranslations("adminVillas.detail.rates");
  const dateCls =
    "bg-[var(--rc-surface2)] border border-[var(--rc-border2)] rounded-lg px-2.5 h-9 text-xs text-[var(--rc-text)] tabular-nums focus-within:ring-1 focus-within:ring-[var(--rc-accent)]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("edit.title")}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--rc-border)] bg-[var(--rc-card)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-[var(--rc-text)]">{t("edit.title")}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("cancel")}
            className="rounded p-1 text-[var(--rc-faint)] hover:text-[var(--rc-text)]"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {!state.isBase && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("startDate")}</label>
              <DateField
                value={state.start}
                onChange={(e) => onChange({ ...state, start: e.target.value, err: false })}
                aria-label={t("startDate")}
                className={dateCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("endDate")}</label>
              <DateField
                value={state.end}
                onChange={(e) => onChange({ ...state, end: e.target.value, err: false })}
                aria-label={t("endDate")}
                className={dateCls}
              />
            </div>
          </div>
        )}

        {!state.isBase && (
          <div className="mb-3">
            <label className="mb-1 block text-[11.5px] text-[var(--rc-muted)]">{t("labelField")}</label>
            <input
              value={state.form.label}
              onChange={(e) => onChange({ ...state, form: { ...state.form, label: e.target.value } })}
              maxLength={60}
              placeholder={t("labelPlaceholder")}
              aria-label={t("labelField")}
              className="w-full rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-2.5 py-2 text-xs text-[var(--rc-text)]"
            />
          </div>
        )}

        <div className="mb-3">
          <label className="mb-1.5 block text-[11.5px] text-[var(--rc-muted)]">{t("seasonField")}</label>
          <div className="flex flex-wrap gap-1.5">
            {SEASON_LIST.map((s) => {
              const on = state.form.season === s;
              return (
                <button
                  type="button"
                  key={s}
                  onClick={() => onChange({ ...state, form: { ...state.form, season: s as Season } })}
                  className="rounded-full border px-2.5 py-1 text-xs font-medium"
                  style={
                    on
                      ? { background: SEASON_VAR[s], borderColor: SEASON_VAR[s], color: "#10151F", fontWeight: 700 }
                      : { borderColor: "var(--rc-border2)", background: "var(--rc-surface2)", color: "var(--rc-text)" }
                  }
                >
                  {tr(`seasons.${s}`)}
                </button>
              );
            })}
          </div>
        </div>

        <PriceFields
          mode={mode}
          fields={state.form}
          fxVndPerKrw={fxVndPerKrw}
          onChange={(f) => onChange({ ...state, form: f })}
        />

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className="rounded-lg bg-[var(--rc-accent)] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {t("edit.save")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--rc-border2)] bg-[var(--rc-surface2)] px-4 py-2 text-xs font-medium text-[var(--rc-text)]"
          >
            {t("cancel")}
          </button>
        </div>
        {state.err && <p className="mt-2 text-[11.5px] text-red-400">{t("invalid")}</p>}
      </div>
    </div>
  );
}
