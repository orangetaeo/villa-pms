"use client";

// C 비품 수정 (a13-amenities-edit) — 주방/화장실/가전 품목 수량 스테퍼 + 수건 대/중/소 매일 제공 수량.
// 미니바는 우리 회사가 직접 운영(#2a) — 공급자 편집 대상 아님: 탭·단가·커스텀 행 모두 제거.
//   미니바 단가(unitPrice)는 고객 청구가(우리 판매가)라 공급자 비노출이 원칙. 서버(amenities PATCH)도 SUPPLIER MINIBAR를 drop.
// PATCH /api/villas/[id]/amenities — 비-MINIBAR amenity만 전송. 저장 후 상세 복귀.
// 마진 비공개: 판매가·마진·KRW·미니바 단가 일절 없음.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AMENITY_CATEGORIES,
  AMENITY_ITEMS,
  type AmenityCategoryKey,
} from "@/lib/amenities";

// 수건 3종 itemKey (화장실 탭 내 '매일 제공 수량' 블록으로 별도 묶음)
const TOWEL_KEYS = ["towelLarge", "towelMedium", "towelSmall"];

// 공급자 편집 카테고리 — 미니바는 회사 직접운영이라 제외(#2a).
const SUPPLIER_CATEGORIES = AMENITY_CATEGORIES.filter((c) => c !== "MINIBAR");

// 직접입력(custom) 카테고리당 최대 개수
const CUSTOM_MAX = 10;

/** 직접입력 비품 — 사전에 없는 항목 (KITCHEN·BATHROOM·APPLIANCE) */
interface CustomItem {
  category: string;
  label: string;
  quantity: number;
}

interface Props {
  villaId: string;
  /** 사전 항목 수량 — key `${category}:${itemKey}` → 수량 (미니바 제외) */
  initialQuantities: Record<string, number>;
  /** 직접입력(custom) 항목 — itemKey="custom" 행에서 분리 (미니바 제외) */
  initialCustoms: CustomItem[];
}

export default function AmenitiesEditor({
  villaId,
  initialQuantities,
  initialCustoms,
}: Props) {
  const t = useTranslations("amenities");
  const router = useRouter();

  const [quantities, setQuantities] = useState<Record<string, number>>(initialQuantities);
  const [customs, setCustoms] = useState<CustomItem[]>(initialCustoms);
  const [activeTab, setActiveTab] = useState<AmenityCategoryKey>("KITCHEN");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  // 직접입력 추가 폼 — 탭 전환 시 초기화
  const [newLabel, setNewLabel] = useState("");
  const [newQty, setNewQty] = useState(1);
  useEffect(() => {
    setNewLabel("");
    setNewQty(1);
  }, [activeTab]);

  // 현재 탭 직접입력 항목 (원본 인덱스 유지)
  const customsForTab = customs
    .map((c, idx) => ({ ...c, idx }))
    .filter((c) => c.category === activeTab);
  const customFull = customsForTab.length >= CUSTOM_MAX;

  function setCustomQty(idx: number, quantity: number) {
    setCustoms((prev) =>
      prev.map((c, i) =>
        i === idx ? { ...c, quantity: Math.max(1, Math.min(99, quantity)) } : c
      )
    );
  }

  function removeCustom(idx: number) {
    setCustoms((prev) => prev.filter((_, i) => i !== idx));
  }

  function addCustom() {
    const label = newLabel.trim();
    if (!label || customFull) return;
    setCustoms((prev) => [
      ...prev,
      { category: activeTab, label, quantity: Math.max(1, Math.min(99, newQty)) },
    ]);
    setNewLabel("");
    setNewQty(1);
  }

  const qtyOf = (category: AmenityCategoryKey, itemKey: string) =>
    quantities[`${category}:${itemKey}`] ?? 0;

  function setQty(category: AmenityCategoryKey, itemKey: string, quantity: number) {
    setQuantities((prev) => {
      const next = { ...prev };
      const key = `${category}:${itemKey}`;
      if (quantity <= 0) delete next[key];
      else next[key] = Math.min(99, quantity);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(false);
    // 사전 항목(수량 > 0). 미니바는 회사 운영이라 공급자 전송 대상 아님 — MINIBAR 제외(#2a).
    const payload: {
      category: string;
      itemKey: string;
      quantity: number;
      customLabel?: string;
    }[] = [];
    for (const [key, quantity] of Object.entries(quantities)) {
      if (quantity <= 0) continue;
      const idx = key.indexOf(":");
      const category = key.slice(0, idx);
      const itemKey = key.slice(idx + 1);
      if (category === "MINIBAR") continue; // 회사 운영 — 공급자 미전송(서버도 drop)
      payload.push({ category, itemKey, quantity });
    }
    // 직접입력(custom) — itemKey="custom" + customLabel 필수. 빈 라벨·0 수량 제외.
    for (const c of customs) {
      const label = c.label.trim();
      if (!label || c.quantity < 1) continue;
      if (c.category === "MINIBAR") continue;
      payload.push({
        category: c.category,
        itemKey: "custom",
        customLabel: label,
        quantity: Math.min(99, c.quantity),
      });
    }

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
  }

  // 화장실 탭: 일반 품목 vs 수건 분리
  const bathroomItems = AMENITY_ITEMS.BATHROOM.filter((i) => !TOWEL_KEYS.includes(i.itemKey));
  const towelItems = AMENITY_ITEMS.BATHROOM.filter((i) => TOWEL_KEYS.includes(i.itemKey));

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 pb-28 pt-6">
      {/* 카테고리 탭 칩 (가로 스크롤) — 미니바 제외(회사 직접운영) */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SUPPLIER_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveTab(category)}
            className={`shrink-0 rounded-full px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
              activeTab === category
                ? "bg-teal-600 text-white shadow-md shadow-teal-600/20"
                : "border-2 border-neutral-100 bg-white text-neutral-500"
            }`}
          >
            {t(`categories.${category}`)}
          </button>
        ))}
      </div>

      {/* 주방·가전 — 전 품목 수량 스테퍼 */}
      {(activeTab === "KITCHEN" || activeTab === "APPLIANCE") && (
        <div className="space-y-1">
          {AMENITY_ITEMS[activeTab].map((item) => (
            <StepperRow
              key={item.itemKey}
              icon={item.icon}
              label={t(`items.${item.itemKey}`)}
              quantity={qtyOf(activeTab, item.itemKey)}
              onChange={(q) => setQty(activeTab, item.itemKey, q)}
            />
          ))}
        </div>
      )}

      {/* 화장실 — 일반 품목 + 수건 대/중/소 매일 제공 수량 블록 */}
      {activeTab === "BATHROOM" && (
        <div className="space-y-6">
          <div className="space-y-1">
            {bathroomItems.map((item) => (
              <StepperRow
                key={item.itemKey}
                icon={item.icon}
                label={t(`items.${item.itemKey}`)}
                quantity={qtyOf("BATHROOM", item.itemKey)}
                onChange={(q) => setQty("BATHROOM", item.itemKey, q)}
              />
            ))}
          </div>
          {/* 수건 블록 */}
          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-500">
              {t("towelBlockTitle")}
            </h3>
            <div className="space-y-3 rounded-xl bg-neutral-50 p-4">
              {towelItems.map((item) => (
                <StepperRow
                  key={item.itemKey}
                  compact
                  icon={item.icon}
                  label={t(`items.${item.itemKey}`)}
                  quantity={qtyOf("BATHROOM", item.itemKey)}
                  onChange={(q) => setQty("BATHROOM", item.itemKey, q)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 직접 추가 — 목록에 없는 항목 (vi 입력 + 수량 필수). 마법사 step-amenities와 동일 UX */}
      <section className="space-y-3 border-t border-neutral-100 pt-5">
        <div>
          <h3 className="text-sm font-bold text-neutral-700">{t("customSectionTitle")}</h3>
          <p className="mt-1 text-[13px] leading-snug text-neutral-500">{t("customCaption")}</p>
        </div>

        {/* 추가된 항목 리스트 */}
        {customsForTab.map((c) => (
          <div
            key={c.idx}
            className="flex items-center justify-between gap-2 rounded-xl border-2 border-neutral-100 bg-white p-3"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800">
              {c.label}
            </span>
            <div className="flex items-center gap-2">
              <Stepper
                quantity={c.quantity}
                onChange={(q) => setCustomQty(c.idx, q)}
                compact
                min={1}
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
          </div>
        ))}

        {/* 추가 폼 / 상한 안내 */}
        {customFull ? (
          <p className="text-[13px] font-medium text-neutral-400">
            {t("customMax", { max: CUSTOM_MAX })}
          </p>
        ) : (
          <div className="space-y-3 rounded-xl border-2 border-dashed border-neutral-200 bg-white p-3">
            <input
              type="text"
              maxLength={60}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("customPlaceholder")}
              className="w-full rounded-xl border-2 border-neutral-100 bg-neutral-50 px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-teal-500 focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <Stepper
                quantity={newQty}
                onChange={(q) => setNewQty(Math.max(1, Math.min(99, q)))}
                min={1}
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

/** 수량 스테퍼 (−/숫자/+). compact는 수건 행용 작은 크기.
 *  min: −의 하한(기본 0 — 사전 항목은 0에서 해제). custom은 min=1(삭제는 별도 버튼). */
function Stepper({
  quantity,
  onChange,
  compact,
  min = 0,
}: {
  quantity: number;
  onChange: (q: number) => void;
  compact?: boolean;
  min?: number;
}) {
  const size = compact ? "h-9 w-9" : "h-11 w-11";
  const numSize = compact ? "w-4 text-base" : "w-8 text-2xl";
  const canDec = quantity > min;
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(quantity - 1)}
        disabled={!canDec}
        aria-label="−"
        className={`flex ${size} items-center justify-center rounded-full border-2 transition-transform active:scale-90 disabled:opacity-40 ${
          canDec ? "border-neutral-200 text-neutral-600" : "border-neutral-200 text-neutral-300"
        }`}
      >
        <span className="material-symbols-outlined text-sm">remove</span>
      </button>
      <span
        className={`text-center font-bold tabular-nums ${numSize} ${
          quantity > 0 ? "text-neutral-900" : "text-neutral-300"
        }`}
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        aria-label="+"
        className={`flex ${size} items-center justify-center rounded-full border-2 border-teal-600 text-teal-600 transition-transform active:scale-90 active:bg-teal-50`}
      >
        <span className="material-symbols-outlined text-sm">add</span>
      </button>
    </div>
  );
}

/** 아이콘 + 라벨 + 스테퍼 한 줄 */
function StepperRow({
  icon,
  label,
  quantity,
  onChange,
  compact,
}: {
  icon: string;
  label: string;
  quantity: number;
  onChange: (q: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${compact ? "" : "py-1"}`}>
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center justify-center rounded-xl ${
            compact ? "h-9 w-9" : "h-10 w-10"
          } ${quantity > 0 ? "bg-teal-50 text-teal-600" : "bg-neutral-100 text-neutral-400"}`}
        >
          <span className="material-symbols-outlined">{icon}</span>
        </div>
        <span className={`font-medium ${quantity > 0 ? "text-neutral-800" : "text-neutral-500"}`}>
          {label}
        </span>
      </div>
      <Stepper quantity={quantity} onChange={onChange} compact={compact} />
    </div>
  );
}
