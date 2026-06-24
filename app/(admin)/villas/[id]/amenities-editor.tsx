"use client";

// 관리자 비품 편집기 (Batch A — 비품 ADMIN CRUD). 공급자 a13-amenities-edit의 다크 버전.
// 카테고리 탭(주방/화장실/가전/미니바) + 수량 스테퍼. 미니바: 사전 항목 단가 + 직접입력 행 추가/삭제.
// PATCH /api/villas/[id]/amenities (전체 교체). 저장 후 router.refresh()로 요약 카드 갱신.
// 미니바 단가는 '고객 청구 단가'(원가·마진 아님) → 관리자 노출·편집 OK. 판매가·KRW 없음.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AMENITY_CATEGORIES,
  AMENITY_ITEMS,
  type AmenityCategoryKey,
} from "@/lib/amenities";
import { formatThousands } from "@/lib/format";
import CollapsibleCard from "@/components/admin/collapsible-card";

const TOWEL_KEYS = ["towelLarge", "towelMedium", "towelSmall"];

export interface AmenityCustomRow {
  id: string;
  label: string;
  quantity: number;
  unitPrice: string; // VND 동 단위 문자열
}

interface Props {
  villaId: string;
  initialQuantities: Record<string, number>; // `${category}:${itemKey}` → 수량
  initialUnitPrices: Record<string, string>; // `MINIBAR:${itemKey}` → VND 문자열
  initialCustom: AmenityCustomRow[];
}

let localCounter = 0;
const localId = () => `ac${Date.now()}_${localCounter++}`;

export default function AdminAmenitiesEditor({
  villaId,
  initialQuantities,
  initialUnitPrices,
  initialCustom,
}: Props) {
  const t = useTranslations("amenities");
  const router = useRouter();

  const [quantities, setQuantities] = useState<Record<string, number>>(initialQuantities);
  const [unitPrices, setUnitPrices] = useState<Record<string, string>>(initialUnitPrices);
  const [customRows, setCustomRows] = useState<AmenityCustomRow[]>(initialCustom);
  const [activeTab, setActiveTab] = useState<AmenityCategoryKey>("KITCHEN");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

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

  function addCustom() {
    setCustomRows((prev) => [...prev, { id: localId(), label: "", quantity: 1, unitPrice: "" }]);
  }
  function updateCustom(id: string, patch: Partial<AmenityCustomRow>) {
    setCustomRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeCustom(id: string) {
    setCustomRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
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
      const price = unitPrices[`MINIBAR:${itemKey}`];
      if (category === "MINIBAR" && price) entry.unitPrice = price;
      payload.push(entry);
    }
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
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("saveError") });
    } finally {
      setSaving(false);
    }
  }

  const bathroomItems = AMENITY_ITEMS.BATHROOM.filter((i) => !TOWEL_KEYS.includes(i.itemKey));
  const towelItems = AMENITY_ITEMS.BATHROOM.filter((i) => TOWEL_KEYS.includes(i.itemKey));

  return (
    <CollapsibleCard
      title={t("editTitle")}
      icon="inventory_2"
      action={
        <>
          {message && (
            <span
              role="status"
              className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
            >
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-admin-primary hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-all whitespace-nowrap flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            {saving ? t("saving") : t("save")}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* 카테고리 탭 */}
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {AMENITY_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveTab(category)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${
                activeTab === category
                  ? "bg-blue-600/15 text-admin-primary border border-blue-500/40"
                  : "bg-slate-900/60 text-slate-400 border border-slate-700 hover:border-slate-500"
              }`}
            >
              {t(`categories.${category}`)}
            </button>
          ))}
        </div>

        {/* 주방·가전 */}
        {(activeTab === "KITCHEN" || activeTab === "APPLIANCE") && (
          <div className="space-y-1.5">
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

        {/* 화장실 — 일반 + 수건 블록 */}
        {activeTab === "BATHROOM" && (
          <div className="space-y-5">
            <div className="space-y-1.5">
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
            <div>
              <p className="text-xs font-bold text-slate-500 mb-2.5 uppercase tracking-wider">
                {t("towelBlockTitle")}
              </p>
              <div className="space-y-2 rounded-lg bg-slate-900/40 border border-slate-800 p-4">
                {towelItems.map((item) => (
                  <StepperRow
                    key={item.itemKey}
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

        {/* 미니바 — 사전 항목(수량+단가) + 커스텀 행 */}
        {activeTab === "MINIBAR" && (
          <div className="space-y-3">
            {AMENITY_ITEMS.MINIBAR.map((item) => {
              const quantity = qtyOf("MINIBAR", item.itemKey);
              const price = unitPrices[`MINIBAR:${item.itemKey}`] ?? "";
              return (
                <div
                  key={item.itemKey}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 border border-slate-800 p-3.5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="material-symbols-outlined text-slate-400 text-lg">{item.icon}</span>
                      <span className="text-sm font-medium text-slate-200">{t(`items.${item.itemKey}`)}</span>
                    </div>
                    <div className="ml-7 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-admin-primary">payments</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={price ? formatThousands(price) : ""}
                        onChange={(e) => setMinibarPrice(item.itemKey, e.target.value)}
                        placeholder={t("priceePlaceholder")}
                        aria-label={t("priceLabel")}
                        className="w-24 bg-transparent border-b border-slate-700 focus:border-blue-500 focus:ring-0 p-0 text-xs font-semibold text-admin-primary tabular-nums"
                      />
                      <span className="text-xs font-semibold text-admin-primary">₫</span>
                    </div>
                  </div>
                  <Stepper value={quantity} onChange={(q) => setQty("MINIBAR", item.itemKey, q)} ariaLabel={t(`items.${item.itemKey}`)} />
                </div>
              );
            })}

            {customRows.map((row) => (
              <div key={row.id} className="rounded-lg border border-blue-500/20 bg-blue-600/[0.04] p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-admin-primary text-sm">edit</span>
                      <input
                        type="text"
                        value={row.label}
                        onChange={(e) => updateCustom(row.id, { label: e.target.value })}
                        placeholder={t("customNamePlaceholder")}
                        aria-label={t("customNameLabel")}
                        maxLength={60}
                        className="w-full bg-transparent border-b border-slate-700 focus:border-blue-500 focus:ring-0 p-0 text-sm font-medium text-slate-100"
                      />
                    </div>
                    <div className="ml-6 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-admin-primary">payments</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.unitPrice ? formatThousands(row.unitPrice) : ""}
                        onChange={(e) => updateCustom(row.id, { unitPrice: e.target.value.replace(/\D/g, "") })}
                        placeholder={t("priceePlaceholder")}
                        aria-label={t("priceLabel")}
                        className="w-24 bg-transparent border-b border-slate-700 focus:border-blue-500 focus:ring-0 p-0 text-xs font-semibold text-admin-primary tabular-nums"
                      />
                      <span className="text-xs font-semibold text-admin-primary">₫</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <Stepper value={row.quantity} onChange={(q) => updateCustom(row.id, { quantity: Math.max(0, q) })} ariaLabel={t("customNameLabel")} />
                    <button
                      type="button"
                      onClick={() => removeCustom(row.id)}
                      aria-label={t("removeCustom")}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addCustom}
              className="w-full rounded-lg border-2 border-dashed border-slate-700 hover:border-blue-500/50 hover:bg-slate-800/30 text-slate-400 hover:text-admin-primary py-3 text-sm font-bold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-base">add</span>
              {t("addCustom")}
            </button>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}

/** 숫자 스테퍼 (−/숫자/+) — sales-editor와 동일 다크 스타일 */
function Stepper({
  value,
  min = 0,
  max = 99,
  onChange,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg h-9 flex-shrink-0" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="−"
        className="w-8 h-9 text-slate-400 hover:text-white flex items-center justify-center"
      >
        <span className="material-symbols-outlined text-sm">remove</span>
      </button>
      <span className="w-7 text-center text-sm font-bold text-slate-100 tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="+"
        className="w-8 h-9 text-slate-400 hover:text-white flex items-center justify-center"
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
}: {
  icon: string;
  label: string;
  quantity: number;
  onChange: (q: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center justify-center rounded-lg h-9 w-9 ${
            quantity > 0 ? "bg-blue-600/15 text-admin-primary" : "bg-slate-900/60 text-slate-500"
          }`}
        >
          <span className="material-symbols-outlined text-lg">{icon}</span>
        </div>
        <span className={`text-sm font-medium ${quantity > 0 ? "text-slate-200" : "text-slate-400"}`}>
          {label}
        </span>
      </div>
      <Stepper value={quantity} onChange={onChange} ariaLabel={label} />
    </div>
  );
}
