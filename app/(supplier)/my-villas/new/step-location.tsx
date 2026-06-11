"use client";

// 2/5 위치·참고 (a2b-location-info) — 전부 선택 입력, 건너뛰기 가능
import { useTranslations } from "next-intl";
import { formatVnd, type WizardState } from "./wizard-types";

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  onNext: () => void;
  onChangeComplex: () => void;
}

export default function StepLocation({ state, update, onNext, onChangeComplex }: Props) {
  const t = useTranslations("wizard.location");
  const tw = useTranslations("wizard");

  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-44 pt-6">
        <h2 className="mb-8 px-1 text-2xl font-bold tracking-tight">{t("title")}</h2>

        <div className="space-y-8">
          {/* 선택한 단지 (1단계에서 변경) */}
          <section>
            <label className="mb-3 block px-1 text-sm font-medium text-neutral-500">
              {t("selectedComplex")}
            </label>
            <div className="flex items-center gap-4 rounded-xl border border-neutral-100 bg-white p-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-teal-50">
                <span className="material-symbols-outlined icon-fill text-teal-600">
                  location_on
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">
                  {state.complex ? t("complexValue", { complex: state.complex }) : t("noComplex")}
                </p>
                <p className="text-sm text-neutral-500">{t("complexArea")}</p>
              </div>
              <button
                type="button"
                onClick={onChangeComplex}
                className="ml-auto shrink-0 p-2 text-sm font-semibold text-teal-600"
              >
                {t("change")}
              </button>
            </div>
          </section>

          {/* 주소 (선택) */}
          <section>
            <div className="mb-2 flex items-end justify-between">
              <label className="block text-sm font-medium text-neutral-700" htmlFor="address">
                {t("address")}
              </label>
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                {t("optional")}
              </span>
            </div>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <span className="material-symbols-outlined text-neutral-400">pin_drop</span>
              </div>
              <input
                id="address"
                type="text"
                value={state.address}
                onChange={(e) => update({ address: e.target.value })}
                placeholder={t("addressPlaceholder")}
                maxLength={255}
                className="block w-full rounded-xl border border-neutral-200 bg-white py-4 pl-11 pr-4 text-lg transition-all focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <p className="mt-2 text-sm text-neutral-400">{t("addressHint")}</p>
          </section>

          {/* 월 임대 시세 (선택) — VND 점 구분 */}
          <section>
            <div className="mb-2 flex items-end justify-between">
              <label className="block text-sm font-medium text-neutral-700" htmlFor="monthly-rent">
                {t("monthlyRent")}
              </label>
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                {t("optional")}
              </span>
            </div>
            <div className="relative">
              <input
                id="monthly-rent"
                type="text"
                inputMode="numeric"
                value={state.monthlyRent ? formatVnd(state.monthlyRent) : ""}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 15);
                  update({ monthlyRent: digits });
                }}
                placeholder="0"
                className="block w-full rounded-xl border border-neutral-200 bg-white px-4 py-4 pr-10 text-lg font-semibold tabular-nums transition-all focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
              />
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                <span className="font-bold text-neutral-500">₫</span>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3">
              <span className="material-symbols-outlined mt-0.5 text-sm text-amber-600">info</span>
              <p className="text-xs leading-relaxed text-amber-800">{t("rentInfo")}</p>
            </div>
          </section>
        </div>
      </main>

      {/* 하단 액션 (a2b): 계속 + 건너뛰기 */}
      <nav className="pb-safe fixed bottom-0 left-0 z-50 flex w-full flex-col gap-1 border-t border-neutral-100 bg-white p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button
          type="button"
          onClick={onNext}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-6 font-label text-base font-bold text-white shadow-lg shadow-teal-600/20 transition-all duration-200 active:scale-[0.98]"
        >
          <span>{tw("continue")}</span>
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex w-full items-center justify-center px-6 py-2 font-label text-sm font-medium text-neutral-500 transition-all duration-200 hover:text-neutral-800 active:scale-[0.98]"
        >
          {tw("skip")}
        </button>
      </nav>
    </>
  );
}
