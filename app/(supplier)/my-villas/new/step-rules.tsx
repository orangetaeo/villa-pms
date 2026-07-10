"use client";

// 6 이용 규칙 (등록 마법사) — 공급자가 직접 입력. 전부 기본값 존재 → 그냥 "다음" 가능(저입력 부담).
// /api/villas/[id]/info(자가 편집)와 동일 필드. 공급자 라이트 테마. 금액=VND 점 구분만(KRW·마진 없음).
// + 와이파이·출입정보(도어락/스마트키) — ⚠ 비공개 등급(고객 미노출) (T-bedroom-composition-sync)
import { useTranslations } from "next-intl";
import { minutesToHHMM, hhmmToMinutes, buildTimeOptions } from "@/lib/sales-display";
import { ACCESS_TYPES, type AccessType } from "@/lib/villa-schema";
import { formatVnd, type WizardState, type VillaRules } from "./wizard-types";

// 출입 방식 아이콘 (Material Symbols) — 화이트리스트와 1:1
const ACCESS_ICON: Record<AccessType, string> = {
  KEYPAD: "dialpad",
  KEY: "key",
  SMARTKEY: "smartphone",
  OTHER: "more_horiz",
};

const TIME_OPTIONS = buildTimeOptions();
const MAX_DEPOSIT_DIGITS = 12;

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  onNext: () => void;
}

export default function StepRules({ state, update, onNext }: Props) {
  const t = useTranslations("wizard.rules");
  const tw = useTranslations("wizard");
  const rules = state.rules;

  const patch = (p: Partial<VillaRules>) => update({ rules: { ...rules, ...p } });
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, MAX_DEPOSIT_DIGITS);

  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-28 pt-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold leading-tight text-neutral-800">{t("title")}</h2>
          <p className="mt-1 text-neutral-500">{t("subtitle")}</p>
        </div>

        {/* 체크인/아웃 */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-500">{t("checkIn")}</span>
            <select
              value={minutesToHHMM(rules.checkInTime)}
              onChange={(e) => patch({ checkInTime: hhmmToMinutes(e.target.value) ?? 840 })}
              className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-3 text-base text-neutral-800 tabular-nums focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-500">{t("checkOut")}</span>
            <select
              value={minutesToHHMM(rules.checkOutTime)}
              onChange={(e) => patch({ checkOutTime: hhmmToMinutes(e.target.value) ?? 660 })}
              className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-3 text-base text-neutral-800 tabular-nums focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>
        </div>

        {/* 허용 토글 4종 */}
        <div className="mb-4 space-y-2">
          <ToggleRow icon="smoking_rooms" label={t("smoking")} on={rules.smokingAllowed} onChange={(v) => patch({ smokingAllowed: v })} />
          <ToggleRow icon="pets" label={t("pets")} on={rules.petsAllowed} onChange={(v) => patch({ petsAllowed: v })} />
          <ToggleRow icon="celebration" label={t("party")} on={rules.partyAllowed} onChange={(v) => patch({ partyAllowed: v })} />
          <ToggleRow icon="add_circle" label={t("extraBed")} on={rules.extraBedAvailable} onChange={(v) => patch({ extraBedAvailable: v })} />
        </div>

        {/* 주차 */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
          <span className="flex items-center gap-2 text-base font-medium text-neutral-700">
            <span className="material-symbols-outlined text-teal-600">local_parking</span>
            {t("parking")}
          </span>
          <Stepper value={rules.parkingSlots} min={0} onChange={(n) => patch({ parkingSlots: n })} ariaLabel={t("parking")} />
        </div>

        {/* 기준 보증금 */}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-500">{t("deposit")}</span>
          <div className="flex h-12 items-center rounded-xl border border-neutral-200 bg-white px-3 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500">
            <input
              type="text"
              inputMode="numeric"
              value={rules.baseDepositVnd ? formatVnd(rules.baseDepositVnd) : ""}
              onChange={(e) => patch({ baseDepositVnd: digits(e.target.value) })}
              placeholder="0"
              aria-label={t("deposit")}
              className="w-full flex-1 border-0 bg-transparent p-0 text-right text-base tabular-nums text-neutral-800 focus:ring-0"
            />
            <span className="ml-1 text-base text-neutral-400">₫</span>
          </div>
          <span className="mt-1 block text-[11px] text-neutral-400">{t("depositNote")}</span>
        </label>

        {/* 와이파이 — ⚠ 비공개(고객 화면 미노출) */}
        <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-amber-600">wifi</span>
              <span className="text-sm font-bold text-neutral-800">{t("wifiTitle")}</span>
            </span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              {t("privateBadge")}
            </span>
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-600">{t("wifiSsid")}</span>
              <input
                type="text"
                value={state.wifiSsid}
                onChange={(e) => update({ wifiSsid: e.target.value })}
                maxLength={100}
                aria-label={t("wifiSsid")}
                className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-3 text-base focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-600">{t("wifiPassword")}</span>
              <input
                type="text"
                value={state.wifiPassword}
                onChange={(e) => update({ wifiPassword: e.target.value })}
                maxLength={100}
                aria-label={t("wifiPassword")}
                className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-3 text-base focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </label>
          </div>
          <p className="mt-2 flex items-start gap-1 text-[11px] leading-relaxed text-amber-700">
            <span className="material-symbols-outlined mt-0.5 text-xs">visibility_off</span>
            {t("wifiHint")}
          </p>
        </section>

        {/* 출입 정보 — ⚠ 비공개(청소 담당·운영자만) */}
        <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-amber-600">lock</span>
              <span className="text-sm font-bold text-neutral-800">{t("accessTitle")}</span>
            </span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              {t("privateBadge")}
            </span>
          </div>

          {/* 출입 방식 아이콘 칩 4종 */}
          <p className="mb-2 text-xs font-medium text-neutral-600">{t("accessType")}</p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {ACCESS_TYPES.map((at) => {
              const on = state.accessType === at;
              return (
                <button
                  key={at}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ accessType: on ? "" : at })}
                  className={`flex items-center gap-2 rounded-xl border-2 px-3 py-3 text-sm font-semibold transition-all active:scale-95 ${
                    on ? "border-teal-500 bg-teal-50 text-teal-700" : "border-neutral-200 bg-white text-neutral-500"
                  }`}
                >
                  <span className="material-symbols-outlined text-base">{ACCESS_ICON[at]}</span>
                  <span className="whitespace-nowrap">{t(`accessTypeOpt.${at}`)}</span>
                </button>
              );
            })}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">{t("accessInfo")}</span>
            <input
              type="text"
              value={state.accessInfo}
              onChange={(e) => update({ accessInfo: e.target.value })}
              maxLength={1000}
              placeholder={t("accessInfoPlaceholder")}
              aria-label={t("accessInfo")}
              className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-3 text-base focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </label>
          <p className="mt-2 flex items-start gap-1 text-[11px] leading-relaxed text-amber-700">
            <span className="material-symbols-outlined mt-0.5 text-xs">visibility_off</span>
            {t("accessHint")}
          </p>
        </section>
      </main>

      {/* 하단 고정: 다음 버튼 */}
      <div className="pb-safe fixed bottom-0 left-0 z-50 w-full border-t border-neutral-100 bg-white p-4 shadow-[0_-8px_20px_rgba(0,0,0,0.05)]">
        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            onClick={onNext}
            className="w-full rounded-xl bg-teal-600 py-4 text-lg font-bold text-white shadow-lg transition-all hover:bg-teal-700 active:scale-[0.98]"
          >
            {tw("continue")}
          </button>
        </div>
      </div>
    </>
  );
}

// ── 보조 컴포넌트 (라이트) ──────────────────────────
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-teal-600" : "bg-neutral-300"}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

function ToggleRow({ icon, label, on, onChange }: { icon: string; label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
      <span className="flex items-center gap-2 text-base font-medium text-neutral-700">
        <span className={`material-symbols-outlined ${on ? "text-teal-600" : "text-neutral-400"}`}>{icon}</span>
        {label}
      </span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

function Stepper({ value, min = 0, max = 99, onChange, ariaLabel }: { value: number; min?: number; max?: number; onChange: (n: number) => void; ariaLabel: string }) {
  return (
    <div className="flex h-11 items-center rounded-xl border border-neutral-200 bg-white" role="group" aria-label={ariaLabel}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="−" className="flex h-11 w-10 items-center justify-center text-neutral-500 hover:text-teal-600">
        <span className="material-symbols-outlined">remove</span>
      </button>
      <span className="w-8 text-center text-base font-bold tabular-nums text-neutral-800">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="+" className="flex h-11 w-10 items-center justify-center text-neutral-500 hover:text-teal-600">
        <span className="material-symbols-outlined">add</span>
      </button>
    </div>
  );
}
