"use client";

// 5/5 원가 입력 (a5-rate-input) — 시즌 3카드 + 숫자 키패드, 3종 모두 입력 전 제출 비활성
// 공급자 화면: VND 점 구분(1.500.000₫)만 — KRW·마진·판매가 절대 노출 금지
import { useState } from "react";
import { useTranslations } from "next-intl";
import { SEASONS, type Season } from "@/lib/villa-schema";
import { formatVnd, type WizardState } from "./wizard-types";

const MAX_DIGITS = 12;

const SEASON_STYLE: Record<Season, { icon: string; iconBg: string; iconColor: string }> = {
  LOW: { icon: "spa", iconBg: "bg-green-100", iconColor: "text-green-600" },
  HIGH: { icon: "sunny", iconBg: "bg-orange-100", iconColor: "text-amber-500" },
  PEAK: { icon: "celebration", iconBg: "bg-red-100", iconColor: "text-red-600" },
};

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  submitting: boolean;
  submitError: boolean;
  onSubmit: () => void;
}

export default function StepRates({ state, update, submitting, submitError, onSubmit }: Props) {
  const t = useTranslations("wizard.rates");
  const tw = useTranslations("wizard");
  const [activeSeason, setActiveSeason] = useState<Season>("LOW");

  const allEntered = SEASONS.every((season) => state.rates[season] !== "");

  function handleKey(key: string) {
    const current = state.rates[activeSeason];
    let next = current;
    if (key === "del") {
      next = current.slice(0, -1);
    } else if (key === "0" && current === "") {
      return; // 선행 0 방지
    } else if (current.length < MAX_DIGITS) {
      next = current + key;
    }
    update({ rates: { ...state.rates, [activeSeason]: next } });
  }

  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-[420px] pt-6">
        <div className="mb-8">
          <h2 className="text-2xl font-bold leading-tight text-neutral-800">{t("title")}</h2>
          <p className="mt-1 text-neutral-500">{t("subtitle")}</p>
        </div>

        {/* 시즌 3카드 — 탭하면 키패드 입력 대상 전환 */}
        <div className="space-y-4">
          {SEASONS.map((season) => {
            const style = SEASON_STYLE[season];
            const value = state.rates[season];
            const isActive = activeSeason === season;
            return (
              <button
                key={season}
                type="button"
                onClick={() => setActiveSeason(season)}
                className={`flex w-full items-center justify-between rounded-xl border-2 p-4 text-left transition-all duration-200 ${
                  isActive ? "border-teal-600 bg-teal-50 shadow-md" : "border-transparent bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${style.iconBg}`}
                  >
                    <span className={`material-symbols-outlined ${style.iconColor}`}>
                      {style.icon}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-neutral-700">{t(season)}</p>
                    <p className="text-xs text-neutral-400">{t(`${season}Hint`)}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span
                    className={`text-lg font-bold tabular-nums ${
                      value === ""
                        ? "text-neutral-300"
                        : isActive
                          ? "text-teal-600"
                          : "text-neutral-400"
                    }`}
                  >
                    {value === "" ? "0₫" : `${formatVnd(value)}₫`}
                  </span>
                  {value === "" && (
                    <span className="text-[10px] font-semibold text-red-600">{t("empty")}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {submitError && (
          <div className="mt-6 flex items-start gap-2 rounded-lg bg-red-50 p-3">
            <span className="material-symbols-outlined mt-0.5 text-sm text-red-600">error</span>
            <p className="text-sm leading-relaxed text-red-700">{tw("submitError")}</p>
          </div>
        )}
      </main>

      {/* 하단 고정: 제출 버튼 + 숫자 키패드 (a5) */}
      <div className="pb-safe fixed bottom-0 left-0 z-50 w-full rounded-t-3xl border-t border-neutral-100 bg-white pt-4 shadow-[0_-8px_20px_rgba(0,0,0,0.05)]">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-4 px-4">
            <button
              type="button"
              disabled={!allEntered || submitting}
              onClick={onSubmit}
              className={`w-full rounded-xl py-4 text-lg font-bold text-white shadow-lg transition-all active:scale-[0.98] ${
                !allEntered || submitting
                  ? "cursor-not-allowed bg-neutral-300"
                  : "bg-teal-600 hover:bg-teal-700"
              }`}
            >
              {submitting ? tw("submitting") : tw("submit")}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-px border-t border-neutral-100 bg-neutral-100">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <KeypadButton key={digit} onClick={() => handleKey(digit)}>
                {digit}
              </KeypadButton>
            ))}
            <div className="bg-neutral-50 py-4 text-center text-2xl font-semibold text-neutral-300">
              .
            </div>
            <KeypadButton onClick={() => handleKey("0")}>0</KeypadButton>
            <button
              type="button"
              onClick={() => handleKey("del")}
              className="flex items-center justify-center bg-neutral-50 py-4 text-neutral-700 transition-transform active:scale-95 active:bg-neutral-200"
            >
              <span className="material-symbols-outlined">backspace</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function KeypadButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white py-4 text-2xl font-semibold text-neutral-700 transition-transform active:scale-95 active:bg-neutral-200"
    >
      {children}
    </button>
  );
}
