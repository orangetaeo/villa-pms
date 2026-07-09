"use client";

// 4/5 비품 (a9-amenities) — 카테고리 4탭 칩 + 체크 타일 2열 그리드 + 미니바 수량 스테퍼
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AMENITY_CATEGORIES,
  AMENITY_ITEMS,
  type AmenityCategoryKey,
} from "@/lib/amenities";
import type { WizardState } from "./wizard-types";
import { WizardGuide } from "./wizard-guide";

interface Props {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  onNext: () => void;
}

export default function StepAmenities({ state, update, onNext }: Props) {
  const t = useTranslations("amenities");
  const tw = useTranslations("wizard");
  const [activeTab, setActiveTab] = useState<AmenityCategoryKey>("KITCHEN");

  const getQuantity = (category: AmenityCategoryKey, itemKey: string) =>
    state.amenities[`${category}:${itemKey}`] ?? 0;

  const setQuantity = (category: AmenityCategoryKey, itemKey: string, quantity: number) => {
    const amenities = { ...state.amenities };
    const key = `${category}:${itemKey}`;
    if (quantity <= 0) delete amenities[key];
    else amenities[key] = Math.min(99, quantity);
    update({ amenities });
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

          {/* 인라인 가이드 — 탭별 전환: 일반 탭="있는 것만 선택+고객 노출", 미니바 탭="수량=비치 개수(가격 아님)"
              오해를 해당 컨텍스트에서만 차단, 화면엔 항상 1문장 (UX-VN 확정, T-tutorial-onboarding-4) */}
          <WizardGuide text={activeTab === "MINIBAR" ? t("guideMinibar") : t("guide")} />

          {activeTab !== "MINIBAR" ? (
            // 체크 타일 2열 그리드
            <div className="grid grid-cols-2 gap-3">
              {AMENITY_ITEMS[activeTab].map((item) => {
                const selected = getQuantity(activeTab, item.itemKey) > 0;
                return (
                  <button
                    key={item.itemKey}
                    type="button"
                    onClick={() => setQuantity(activeTab, item.itemKey, selected ? 0 : 1)}
                    className={`relative flex min-h-[6.5rem] flex-col items-center justify-center gap-2 rounded-xl border-2 p-5 transition-transform active:scale-95 ${
                      selected ? "border-teal-600 bg-teal-50" : "border-neutral-100 bg-white"
                    }`}
                  >
                    {selected && (
                      <span className="material-symbols-outlined icon-fill absolute right-2.5 top-2.5 text-[20px] text-teal-600">
                        check_circle
                      </span>
                    )}
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
                );
              })}
            </div>
          ) : (
            // 미니바 — +/− 수량 스테퍼 리스트
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
