"use client";

// 1/5 기본 정보 (a2-basic-info) — 빌라명·단지·스테퍼 3종·수영장/조식 토글
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { WizardState } from "./wizard-types";

// 단지명은 고유명사 — 번역하지 않는다 (i18n 용어 사전 규칙)
const COMPLEXES = ["Sonasea", "Sunset Sanato", "Vinpearl"];

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  onNext: () => void;
  onHome: () => void;
}

export default function StepBasic({ state, update, onNext, onHome }: Props) {
  const t = useTranslations("wizard.basic");
  const tw = useTranslations("wizard");
  const [nameError, setNameError] = useState(false);

  function handleContinue() {
    if (!state.name.trim()) {
      setNameError(true);
      return;
    }
    onNext();
  }

  return (
    <>
      <main className="flex-1 overflow-y-auto px-4 pb-32 pt-6">
        <div className="mx-auto max-w-md space-y-8">
          <h2 className="px-1 text-2xl font-bold text-neutral-900">{t("title")}</h2>

          {/* 빌라명 */}
          <section className="space-y-3">
            <label className="block px-1 text-sm font-semibold text-neutral-700" htmlFor="villa-name">
              {t("name")}
            </label>
            <input
              id="villa-name"
              type="text"
              value={state.name}
              onChange={(e) => {
                update({ name: e.target.value });
                if (e.target.value.trim()) setNameError(false);
              }}
              placeholder={t("namePlaceholder")}
              maxLength={100}
              className={`h-14 w-full rounded-xl border-2 bg-white px-4 text-lg font-medium transition-colors focus:border-teal-600 focus:ring-0 ${
                nameError ? "border-red-400" : "border-neutral-100"
              }`}
            />
            {nameError && (
              <p className="px-1 text-sm font-medium text-red-600">{t("nameRequired")}</p>
            )}
          </section>

          {/* 단지 */}
          <section className="space-y-3">
            <label className="block px-1 text-sm font-semibold text-neutral-700" htmlFor="complex-select">
              {t("complex")}
            </label>
            <div className="relative">
              <select
                id="complex-select"
                value={state.complex}
                onChange={(e) => update({ complex: e.target.value })}
                className="h-14 w-full appearance-none rounded-xl border-2 border-neutral-100 bg-white px-4 text-lg font-medium transition-colors focus:border-teal-600 focus:ring-0"
              >
                <option value="">{t("complexPlaceholder")}</option>
                {COMPLEXES.map((complex) => (
                  <option key={complex} value={complex}>
                    {complex}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                <span className="material-symbols-outlined text-neutral-400">expand_more</span>
              </div>
            </div>
          </section>

          {/* 스테퍼 3종 */}
          <div className="grid grid-cols-1 gap-6">
            <StepperRow
              title={t("bedrooms")}
              hint={t("bedroomsHint")}
              value={state.bedrooms}
              min={1}
              max={20}
              onChange={(bedrooms) => update({ bedrooms })}
            />
            <StepperRow
              title={t("bathrooms")}
              hint={t("bathroomsHint")}
              value={state.bathrooms}
              min={1}
              max={20}
              onChange={(bathrooms) => update({ bathrooms })}
            />
            <StepperRow
              title={t("maxGuests")}
              hint={t("maxGuestsHint")}
              value={state.maxGuests}
              min={1}
              max={50}
              onChange={(maxGuests) => update({ maxGuests })}
            />
          </div>

          {/* 수영장·조식 토글 */}
          <div className="space-y-4">
            <h3 className="px-1 text-sm font-semibold text-neutral-700">{t("basicAmenities")}</h3>
            <ToggleRow
              icon="pool"
              label={t("pool")}
              checked={state.hasPool}
              onChange={(hasPool) => update({ hasPool })}
            />
            <ToggleRow
              icon="breakfast_dining"
              label={t("breakfast")}
              checked={state.breakfastAvailable}
              onChange={(breakfastAvailable) => update({ breakfastAvailable })}
            />
          </div>
        </div>
      </main>

      {/* 하단 액션 (a2): 홈 + 계속 */}
      <footer className="pb-safe fixed bottom-0 z-50 w-full border-t border-neutral-100 bg-white shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <div className="mx-auto flex w-full max-w-md items-center justify-around px-4 py-3">
          <button
            type="button"
            onClick={onHome}
            className="flex h-14 w-1/3 flex-col items-center justify-center text-neutral-400 transition-transform duration-150 active:scale-95"
          >
            <span className="material-symbols-outlined">home</span>
            <span className="mt-1 font-label text-xs font-medium">{tw("home")}</span>
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="ml-4 flex h-14 w-2/3 flex-col items-center justify-center rounded-xl bg-teal-600 text-white shadow-lg shadow-teal-600/20 transition-transform duration-150 active:scale-95"
          >
            <div className="flex items-center justify-center gap-2">
              <span className="font-label text-sm font-bold">{tw("continue")}</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </div>
          </button>
        </div>
      </footer>
    </>
  );
}

function StepperRow({
  title,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  title: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <section className="flex items-center justify-between rounded-xl border-2 border-neutral-100 bg-white p-5">
      <div>
        <h3 className="font-semibold text-neutral-800">{title}</h3>
        <p className="text-xs text-neutral-400">{hint}</p>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-teal-600 text-teal-600 transition-transform active:scale-90"
        >
          <span className="material-symbols-outlined">remove</span>
        </button>
        <span className="w-8 text-center text-2xl font-bold tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-600 text-white transition-transform active:scale-90"
        >
          <span className="material-symbols-outlined">add</span>
        </button>
      </div>
    </section>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-xl border-2 border-neutral-100 bg-white p-5 transition-colors active:bg-neutral-50">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
          <span className="material-symbols-outlined">{icon}</span>
        </div>
        <span className="font-medium text-neutral-800">{label}</span>
      </div>
      {/* 켜짐 표시를 React 상태(checked)가 직접 제어 — peer-checked CSS 의존 제거
          (숨겨진 체크박스 :checked 선택자에 기대면 환경에 따라 노브가 안 움직이는 버그가 있었음) */}
      <span
        className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-teal-600" : "bg-neutral-200"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span
          className={`absolute top-1 h-6 w-6 rounded-full border bg-white shadow transition-transform ${
            checked ? "translate-x-7 border-white" : "translate-x-1 border-gray-300"
          }`}
        />
      </span>
    </label>
  );
}
