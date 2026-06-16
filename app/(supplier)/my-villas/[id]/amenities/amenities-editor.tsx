"use client";

// 공급자 비품 수정 에디터 (T6.4) — a9-amenities UI 패턴 재사용(카테고리 4탭·체크 타일·미니바 스테퍼).
// 마법사 푸터(계속/건너뛰기) 대신 저장/취소. 저장 시 PATCH /api/villas/[id]/amenities → 상세 복귀.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AMENITY_CATEGORIES,
  AMENITY_ITEMS,
  type AmenityCategoryKey,
} from "@/lib/amenities";

interface Props {
  villaId: string;
  /** 현재 비품 — key: `${category}:${itemKey}` → 수량 (마법사 상태와 동일 규약) */
  initial: Record<string, number>;
}

export default function AmenitiesEditor({ villaId, initial }: Props) {
  const t = useTranslations("amenities");
  const router = useRouter();
  const [amenities, setAmenities] = useState<Record<string, number>>(initial);
  const [activeTab, setActiveTab] = useState<AmenityCategoryKey>("KITCHEN");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const getQuantity = (category: AmenityCategoryKey, itemKey: string) =>
    amenities[`${category}:${itemKey}`] ?? 0;

  const setQuantity = (category: AmenityCategoryKey, itemKey: string, quantity: number) => {
    const next = { ...amenities };
    const key = `${category}:${itemKey}`;
    if (quantity <= 0) delete next[key];
    else next[key] = Math.min(99, quantity);
    setAmenities(next);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(false);
    // key(`cat:itemKey`) → API payload. itemKey에 콜론 없음(사전 키) — 첫 ":"로 분리
    const payload = Object.entries(amenities).map(([key, quantity]) => {
      const idx = key.indexOf(":");
      return { category: key.slice(0, idx), itemKey: key.slice(idx + 1), quantity };
    });
    try {
      const res = await fetch(`/api/villas/${villaId}/amenities`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amenities: payload }),
      });
      if (!res.ok) {
        setError(true);
        setSaving(false);
        return;
      }
      router.push(`/my-villas/${villaId}`);
      router.refresh();
    } catch {
      setError(true);
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 pb-28 pt-6">
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
                  <span className="font-semibold text-neutral-800">{t(`items.${item.itemKey}`)}</span>
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

      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert">
          {t("saveError")}
        </p>
      )}

      {/* 저장/취소 — 인라인(고정 TabBar와 이중바 방지) */}
      <div className="flex flex-col gap-2 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-white shadow-lg shadow-teal-600/20 transition-transform active:scale-95 disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-base">save</span>
          <span className="font-bold">{saving ? t("saving") : t("save")}</span>
        </button>
        <button
          type="button"
          onClick={() => router.push(`/my-villas/${villaId}`)}
          disabled={saving}
          className="py-2 text-sm font-semibold text-neutral-400 active:opacity-70 disabled:opacity-60"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
