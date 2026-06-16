"use client";

// C 비품 수정 개편 (a13-amenities-edit) — 전 카테고리(주방/화장실/가전/미니바) 모든 품목 수량 스테퍼.
// 수건 대/중/소 3종 '매일 제공 수량'(화장실 탭 내 별도 블록). 미니바 사전 항목 + 직접입력 행(라벨+가격+수량) 추가/삭제.
// PATCH /api/villas/[id]/amenities — unitPrice·customLabel·note 전송. 저장 후 상세 복귀.
// 마진 비공개: 가격은 미니바 '공급자 본인 원가(고객 청구 단가)'에만. 판매가·마진·KRW 없음.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AMENITY_CATEGORIES,
  AMENITY_ITEMS,
  type AmenityCategoryKey,
} from "@/lib/amenities";
import { formatVnd } from "@/app/(supplier)/my-villas/new/wizard-types";

// 수건 3종 itemKey (화장실 탭 내 '매일 제공 수량' 블록으로 별도 묶음)
const TOWEL_KEYS = ["towelLarge", "towelMedium", "towelSmall"];

interface CustomRow {
  id: string; // 클라 로컬 키
  label: string;
  quantity: number;
  unitPrice: string; // VND 동 단위 문자열
}

interface Props {
  villaId: string;
  /** 사전 항목 수량 — key `${category}:${itemKey}` → 수량 */
  initialQuantities: Record<string, number>;
  /** 미니바 사전 항목 단가 — key `MINIBAR:${itemKey}` → VND 문자열 */
  initialUnitPrices: Record<string, string>;
  /** 미니바 직접입력 행 */
  initialCustom: CustomRow[];
}

export default function AmenitiesEditor({
  villaId,
  initialQuantities,
  initialUnitPrices,
  initialCustom,
}: Props) {
  const t = useTranslations("amenities");
  const router = useRouter();

  const [quantities, setQuantities] = useState<Record<string, number>>(initialQuantities);
  const [unitPrices, setUnitPrices] = useState<Record<string, string>>(initialUnitPrices);
  const [customRows, setCustomRows] = useState<CustomRow[]>(initialCustom);
  const [activeTab, setActiveTab] = useState<AmenityCategoryKey>("KITCHEN");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

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

  function setMinibarPrice(itemKey: string, digits: string) {
    setUnitPrices((prev) => ({ ...prev, [`MINIBAR:${itemKey}`]: digits.replace(/\D/g, "") }));
  }

  // ── 미니바 커스텀 행 ──────────────────────────────
  function addCustom() {
    setCustomRows((prev) => [
      ...prev,
      { id: `c${Date.now()}`, label: "", quantity: 1, unitPrice: "" },
    ]);
  }
  function updateCustom(id: string, patch: Partial<CustomRow>) {
    setCustomRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeCustom(id: string) {
    setCustomRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setError(false);
    // 사전 항목(수량 > 0)
    const payload: {
      category: string;
      itemKey: string;
      quantity: number;
      unitPrice?: string;
      customLabel?: string;
    }[] = [];
    for (const [key, quantity] of Object.entries(quantities)) {
      if (quantity <= 0) continue;
      const idx = key.indexOf(":");
      const category = key.slice(0, idx);
      const itemKey = key.slice(idx + 1);
      const entry: (typeof payload)[number] = { category, itemKey, quantity };
      // 미니바 사전 항목 단가 동반
      const price = unitPrices[`MINIBAR:${itemKey}`];
      if (category === "MINIBAR" && price) entry.unitPrice = price;
      payload.push(entry);
    }
    // 미니바 커스텀 행 — 라벨 있는 것만
    for (const row of customRows) {
      const label = row.label.trim();
      if (!label || row.quantity <= 0) continue;
      payload.push({
        category: "MINIBAR",
        itemKey: "custom",
        quantity: row.quantity,
        customLabel: label,
        ...(row.unitPrice ? { unitPrice: row.unitPrice } : {}),
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
      {/* 카테고리 탭 칩 (가로 스크롤) */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {AMENITY_CATEGORIES.map((category) => (
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

      {/* 미니바 — 사전 항목(수량 + 단가) + 커스텀 행 추가/삭제 */}
      {activeTab === "MINIBAR" && (
        <div className="space-y-4">
          {AMENITY_ITEMS.MINIBAR.map((item) => {
            const quantity = qtyOf("MINIBAR", item.itemKey);
            const price = unitPrices[`MINIBAR:${item.itemKey}`] ?? "";
            return (
              <div
                key={item.itemKey}
                className="flex items-center justify-between rounded-xl border-2 border-neutral-100 bg-white p-4"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[20px] text-neutral-600">
                      {item.icon}
                    </span>
                    <span className="font-medium text-neutral-800">{t(`items.${item.itemKey}`)}</span>
                  </div>
                  {/* 단가 입력 (공급자 본인 원가 — 점 구분 미리보기) */}
                  <div className="ml-8 flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-teal-600">payments</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={price ? formatVnd(price) : ""}
                      onChange={(e) => setMinibarPrice(item.itemKey, e.target.value)}
                      placeholder={t("priceePlaceholder")}
                      aria-label={t("priceLabel")}
                      className="w-24 border-b border-teal-200 bg-transparent p-0 text-xs font-semibold text-teal-600 outline-none focus:border-teal-600"
                    />
                    <span className="text-xs font-semibold text-teal-600">₫</span>
                  </div>
                </div>
                <Stepper quantity={quantity} onChange={(q) => setQty("MINIBAR", item.itemKey, q)} />
              </div>
            );
          })}

          {/* 커스텀 행 */}
          {customRows.map((row) => (
            <div
              key={row.id}
              className="rounded-xl border border-teal-100 bg-teal-50/50 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-teal-600">edit</span>
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => updateCustom(row.id, { label: e.target.value })}
                      placeholder={t("customNamePlaceholder")}
                      aria-label={t("customNameLabel")}
                      maxLength={60}
                      className="w-full border-b border-teal-200 bg-transparent p-0 text-sm font-medium text-neutral-800 outline-none focus:border-teal-600"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-teal-600">payments</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.unitPrice ? formatVnd(row.unitPrice) : ""}
                      onChange={(e) =>
                        updateCustom(row.id, { unitPrice: e.target.value.replace(/\D/g, "") })
                      }
                      placeholder={t("priceePlaceholder")}
                      aria-label={t("priceLabel")}
                      className="w-24 border-b border-teal-200 bg-transparent p-0 text-xs font-semibold text-teal-600 outline-none focus:border-teal-600"
                    />
                    <span className="text-xs font-semibold text-teal-600">₫</span>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <Stepper
                    compact
                    quantity={row.quantity}
                    onChange={(q) => updateCustom(row.id, { quantity: Math.max(0, q) })}
                  />
                  <button
                    type="button"
                    onClick={() => removeCustom(row.id)}
                    aria-label={t("removeCustom")}
                    className="mt-1 text-red-500 active:opacity-50"
                  >
                    <span className="material-symbols-outlined">cancel</span>
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addCustom}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 font-semibold text-neutral-500 transition-colors active:bg-neutral-50"
          >
            <span className="material-symbols-outlined">add</span>
            {t("addCustom")}
          </button>
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

/** 수량 스테퍼 (−/숫자/+). compact는 수건·커스텀 행용 작은 크기 */
function Stepper({
  quantity,
  onChange,
  compact,
}: {
  quantity: number;
  onChange: (q: number) => void;
  compact?: boolean;
}) {
  const size = compact ? "h-9 w-9" : "h-11 w-11";
  const numSize = compact ? "w-4 text-base" : "w-8 text-2xl";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(quantity - 1)}
        aria-label="−"
        className={`flex ${size} items-center justify-center rounded-full border-2 transition-transform active:scale-90 ${
          quantity > 0 ? "border-neutral-200 text-neutral-600" : "border-neutral-200 text-neutral-300"
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
