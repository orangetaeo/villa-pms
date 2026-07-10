"use client";

// 4/5 비품 (a9-amenities) — 카테고리 4탭 칩 + 체크 타일(선택 시 수량 스테퍼) + 직접입력 + 미니바 스테퍼
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AMENITY_CATEGORIES,
  AMENITY_ITEMS,
  type AmenityCategoryKey,
} from "@/lib/amenities";
import type { CustomAmenityCategory, WizardState } from "./wizard-types";
// 공용 인라인 가이드 (T-9에서 wizard-guide.tsx 승격 — light 톤 동일)
import { InlineGuide } from "@/components/inline-guide";

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  onNext: () => void;
}

const CUSTOM_MAX = 10;

/** 컴팩트 +/− 수량 스테퍼. 터치가 상위 타일 토글로 전파되지 않게 stopPropagation.
 *  min 이하로는 내려가지 않음(− 비활성). 타일용은 min=0(0이면 상위에서 선택 해제 처리). */
function QtyStepper({
  value,
  onChange,
  min,
  compact = false,
  labelDecrease,
  labelIncrease,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  compact?: boolean;
  labelDecrease: string;
  labelIncrease: string;
}) {
  const dim = compact ? "h-9 w-9" : "h-11 w-11";
  const canDec = value > min;
  const canInc = value < 99;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        aria-label={labelDecrease}
        disabled={!canDec}
        onClick={(e) => {
          e.stopPropagation();
          onChange(value - 1);
        }}
        className={`flex ${dim} items-center justify-center rounded-full border-2 transition-transform active:scale-90 ${
          canDec ? "border-teal-600 text-teal-600" : "border-neutral-200 text-neutral-300"
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">remove</span>
      </button>
      <span className="w-7 text-center text-lg font-bold tabular-nums text-neutral-900">
        {value}
      </span>
      <button
        type="button"
        aria-label={labelIncrease}
        disabled={!canInc}
        onClick={(e) => {
          e.stopPropagation();
          onChange(value + 1);
        }}
        className={`flex ${dim} items-center justify-center rounded-full text-white transition-transform active:scale-90 ${
          canInc ? "bg-teal-600" : "bg-neutral-200"
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
      </button>
    </div>
  );
}

export default function StepAmenities({ state, update, onNext }: Props) {
  const t = useTranslations("amenities");
  const tw = useTranslations("wizard");
  const [activeTab, setActiveTab] = useState<AmenityCategoryKey>("KITCHEN");

  // 직접입력 추가 폼 로컬 상태 — 탭 전환 시 초기화
  const [newLabel, setNewLabel] = useState("");
  const [newQty, setNewQty] = useState(1);
  useEffect(() => {
    setNewLabel("");
    setNewQty(1);
  }, [activeTab]);

  const stepperLabels = {
    labelDecrease: t("decrease"),
    labelIncrease: t("increase"),
  };

  const getQuantity = (category: AmenityCategoryKey, itemKey: string) =>
    state.amenities[`${category}:${itemKey}`] ?? 0;

  const setQuantity = (category: AmenityCategoryKey, itemKey: string, quantity: number) => {
    const amenities = { ...state.amenities };
    const key = `${category}:${itemKey}`;
    if (quantity <= 0) delete amenities[key];
    else amenities[key] = Math.min(99, quantity);
    update({ amenities });
  };

  // 직접입력 항목 (원본 배열 인덱스 유지) — 현재 탭 것만 노출
  const customCat = activeTab as CustomAmenityCategory;
  const customForTab = state.customAmenities
    .map((c, idx) => ({ ...c, idx }))
    .filter((c) => c.category === activeTab);
  const customFull = customForTab.length >= CUSTOM_MAX;

  const setCustomQty = (idx: number, quantity: number) => {
    const next = state.customAmenities.map((c, i) =>
      i === idx ? { ...c, quantity: Math.max(1, Math.min(99, quantity)) } : c
    );
    update({ customAmenities: next });
  };

  const removeCustom = (idx: number) => {
    update({ customAmenities: state.customAmenities.filter((_, i) => i !== idx) });
  };

  const addCustom = () => {
    const label = newLabel.trim();
    if (!label || customFull) return;
    update({
      customAmenities: [
        ...state.customAmenities,
        { category: customCat, label, quantity: Math.max(1, Math.min(99, newQty)) },
      ],
    });
    setNewLabel("");
    setNewQty(1);
  };

  return (
    <>
      <main className="flex-1 overflow-y-auto px-4 pb-40 pt-6">
        <div className="mx-auto max-w-md space-y-6">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-2xl font-bold text-neutral-900">{t("title")}</h2>
            <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-400">
              {t("optional")}
            </span>
          </div>

          {/* 카테고리 탭 칩 (가로 스크롤) */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {AMENITY_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveTab(category)}
                className={`shrink-0 rounded-full px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                  activeTab === category
                    ? "bg-teal-600 text-white shadow-md shadow-teal-600/20"
                    : "border-2 border-neutral-100 bg-white text-neutral-500"
                }`}
              >
                {t(`categories.${category}`)}
              </button>
            ))}
          </div>

          {/* 인라인 가이드 — 탭별 전환: 일반 탭="있는 것만 선택+개수 입력+고객 노출", 미니바 탭="수량=비치 개수(가격 아님)"
              오해를 해당 컨텍스트에서만 차단, 화면엔 항상 1문장 (UX-VN 확정, T-tutorial-onboarding-4) */}
          <InlineGuide text={activeTab === "MINIBAR" ? t("guideMinibar") : t("guide")} />

          {activeTab !== "MINIBAR" ? (
            <>
              {/* 체크 타일 2열 그리드 — 선택 시 하단 수량 스테퍼 */}
              <div className="grid grid-cols-2 items-start gap-3">
                {AMENITY_ITEMS[activeTab].map((item) => {
                  const quantity = getQuantity(activeTab, item.itemKey);
                  const selected = quantity > 0;
                  return (
                    <div
                      key={item.itemKey}
                      className={`relative flex flex-col overflow-hidden rounded-xl border-2 transition-colors ${
                        selected ? "border-teal-600 bg-teal-50" : "border-neutral-100 bg-white"
                      }`}
                    >
                      {selected && (
                        <span className="material-symbols-outlined icon-fill pointer-events-none absolute right-2.5 top-2.5 text-[20px] text-teal-600">
                          check_circle
                        </span>
                      )}
                      {/* 타일 탭 = 선택 토글 (수량 1로 시작 / 해제) */}
                      <button
                        type="button"
                        onClick={() => setQuantity(activeTab, item.itemKey, selected ? 0 : 1)}
                        className="flex min-h-[6.5rem] w-full flex-1 flex-col items-center justify-center gap-2 p-5 transition-transform active:scale-95"
                      >
                        <span
                          className={`material-symbols-outlined text-3xl ${
                            selected ? "text-teal-700" : "text-neutral-400"
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span
                          className={`text-sm font-semibold ${
                            selected ? "text-teal-900" : "text-neutral-600"
                          }`}
                        >
                          {t(`items.${item.itemKey}`)}
                        </span>
                      </button>
                      {/* 선택 시 수량 스테퍼 — 0이 되면 선택 해제 (min=0) */}
                      {selected && (
                        <div className="flex justify-center border-t border-teal-100 bg-teal-50/60 px-2 py-2">
                          <QtyStepper
                            value={quantity}
                            min={0}
                            compact
                            onChange={(n) => setQuantity(activeTab, item.itemKey, n)}
                            {...stepperLabels}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 직접 추가 섹션 — 목록에 없는 항목 (vi 입력 + 수량 필수) */}
              <section className="space-y-3 border-t border-neutral-100 pt-5">
                <div className="px-1">
                  <h3 className="text-sm font-bold text-neutral-700">
                    {t("customSectionTitle")}
                  </h3>
                  <p className="mt-1 text-[13px] leading-snug text-neutral-500">
                    {t("customCaption")}
                  </p>
                </div>

                {/* 추가된 항목 리스트 */}
                {customForTab.map((c) => (
                  <div
                    key={c.idx}
                    className="flex items-center gap-2 rounded-xl border-2 border-neutral-100 bg-white p-3"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800">
                      {c.label}
                    </span>
                    <QtyStepper
                      value={c.quantity}
                      min={1}
                      compact
                      onChange={(n) => setCustomQty(c.idx, n)}
                      {...stepperLabels}
                    />
                    <button
                      type="button"
                      aria-label={t("removeCustom")}
                      onClick={() => removeCustom(c.idx)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-transform active:scale-90"
                    >
                      <span className="material-symbols-outlined text-[22px]">delete</span>
                    </button>
                  </div>
                ))}

                {/* 추가 폼 / 상한 안내 */}
                {customFull ? (
                  <p className="px-1 text-[13px] font-medium text-neutral-400">
                    {t("customMax", { max: CUSTOM_MAX })}
                  </p>
                ) : (
                  <div className="space-y-3 rounded-xl border-2 border-dashed border-neutral-200 bg-white p-3">
                    <input
                      type="text"
                      inputMode="text"
                      maxLength={60}
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder={t("customPlaceholder")}
                      className="w-full rounded-xl border-2 border-neutral-100 bg-neutral-50 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-teal-500 focus:outline-none"
                    />
                    <div className="flex items-center justify-between">
                      <QtyStepper
                        value={newQty}
                        min={1}
                        onChange={setNewQty}
                        {...stepperLabels}
                      />
                      <button
                        type="button"
                        onClick={addCustom}
                        disabled={!newLabel.trim()}
                        className="flex h-11 items-center gap-1.5 rounded-xl bg-teal-600 px-5 font-bold text-white transition-transform active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400"
                      >
                        <span className="material-symbols-outlined text-[20px]">add</span>
                        <span className="text-sm">{t("addItem")}</span>
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </>
          ) : (
            // 미니바 — +/− 수량 스테퍼 리스트 (현행 유지)
            <div className="space-y-3">
              {AMENITY_ITEMS.MINIBAR.map((item) => {
                const quantity = getQuantity("MINIBAR", item.itemKey);
                return (
                  <section
                    key={item.itemKey}
                    className="flex items-center justify-between rounded-xl border-2 border-neutral-100 bg-white p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                        <span className="material-symbols-outlined">{item.icon}</span>
                      </div>
                      <span className="font-semibold text-neutral-800">
                        {t(`items.${item.itemKey}`)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setQuantity("MINIBAR", item.itemKey, quantity - 1)}
                        className={`flex h-11 w-11 items-center justify-center rounded-full border-2 transition-transform active:scale-90 ${
                          quantity > 0
                            ? "border-teal-600 text-teal-600"
                            : "border-neutral-200 text-neutral-300"
                        }`}
                      >
                        <span className="material-symbols-outlined">remove</span>
                      </button>
                      <span
                        className={`w-8 text-center text-2xl font-bold tabular-nums ${
                          quantity > 0 ? "text-neutral-900" : "text-neutral-300"
                        }`}
                      >
                        {quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantity("MINIBAR", item.itemKey, quantity + 1)}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-600 text-white transition-transform active:scale-90"
                      >
                        <span className="material-symbols-outlined">add</span>
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* 하단 액션 (a9): 계속 + 건너뛰기 */}
      <footer className="pb-safe fixed bottom-0 z-50 w-full border-t border-neutral-100 bg-white shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={onNext}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-white shadow-lg shadow-teal-600/20 transition-transform duration-150 active:scale-95"
          >
            <span className="font-label text-sm font-bold">{tw("continue")}</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
          <button
            type="button"
            onClick={onNext}
            className="py-2 text-sm font-semibold text-neutral-400 active:opacity-70"
          >
            {tw("skip")}
          </button>
        </div>
      </footer>
    </>
  );
}
