"use client";

// 관리자 비품 편집기 (Batch A — 비품 ADMIN CRUD). 공급자 a13-amenities-edit의 다크 버전.
// 카테고리 탭(주방/화장실/가전) + 수량 스테퍼.
// ★ #2b: 미니바는 회사표준 1세트(MinibarItem, /settings/minibar)로 분리 — 빌라별 미니바 탭·단가 제거.
//   PATCH /api/villas/[id]/amenities는 MINIBAR 항목을 무시한다(전송하지 않음).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AMENITY_CATEGORIES,
  AMENITY_ITEMS,
  type AmenityCategoryKey,
} from "@/lib/amenities";
import CollapsibleCard from "@/components/admin/collapsible-card";

const TOWEL_KEYS = ["towelLarge", "towelMedium", "towelSmall"];

// 빌라별 편집 대상 카테고리 — 미니바 제외(#2b: 회사표준 분리)
const EDITABLE_CATEGORIES: AmenityCategoryKey[] = AMENITY_CATEGORIES.filter(
  (c) => c !== "MINIBAR"
);

interface Props {
  villaId: string;
  initialQuantities: Record<string, number>; // `${category}:${itemKey}` → 수량
}

export default function AdminAmenitiesEditor({ villaId, initialQuantities }: Props) {
  const t = useTranslations("amenities");
  const router = useRouter();

  const [quantities, setQuantities] = useState<Record<string, number>>(initialQuantities);
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

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const payload: { category: string; itemKey: string; quantity: number }[] = [];
    for (const [key, quantity] of Object.entries(quantities)) {
      if (quantity <= 0) continue;
      const idx = key.indexOf(":");
      const category = key.slice(0, idx);
      const itemKey = key.slice(idx + 1);
      // 미니바는 회사표준(#2b)으로 분리 — 빌라별 저장 대상 아님(전송 제외)
      if (category === "MINIBAR") continue;
      payload.push({ category, itemKey, quantity });
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
        {/* 카테고리 탭 (미니바 제외) */}
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {EDITABLE_CATEGORIES.map((category) => (
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
