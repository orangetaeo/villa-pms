"use client";

// 관리자 비품 편집기 (Batch A — 비품 ADMIN CRUD). 공급자 a13-amenities-edit의 다크 버전.
// 카테고리 탭(주방/화장실/가전) + 수량 스테퍼 + 직접입력(custom) 섹션.
// ★ #2b: 미니바는 회사표준 1세트(MinibarItem, /settings/minibar)로 분리 — 빌라별 미니바 탭·단가 제거.
//   PATCH /api/villas/[id]/amenities는 MINIBAR 항목을 무시한다(전송하지 않음).
// ★ custom(공급자 직접입력) 행: 전체교체 PATCH이므로 저장 시 반드시 되돌려 보낸다 —
//   빠뜨리면 공급자가 입력한 custom이 관리자 저장으로 삭제된다(계약 완료기준 3).
//   기존 custom 행은 customLabel(vi 원문)을 그대로 보존해 전송(번역본을 보내면 원문 유실).
//   관리자 신규 추가분은 입력한 라벨을 customLabel로 전송 → 서버 번역 파이프라인이 customLabelKo 처리.
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

// 카테고리당 custom 항목 상한 — 서버 zod superRefine과 동일(10개).
const CUSTOM_MAX = 10;
// 직접입력 라벨 최대 길이 — 서버 zod와 동일(60자).
const CUSTOM_LABEL_MAX = 60;

/** custom(직접입력) 행 — label=vi 원문(customLabel), labelKo=ko 저장형 번역(null=미번역) */
interface CustomRow {
  label: string;
  labelKo: string | null;
  quantity: number;
}

interface InitialCustom {
  label: string;
  labelKo: string | null;
  quantity: number;
  category: string;
}

interface Props {
  villaId: string;
  initialQuantities: Record<string, number>; // `${category}:${itemKey}` → 수량
  initialCustoms: InitialCustom[]; // 공급자·관리자 직접입력 항목 (카테고리별)
}

export default function AdminAmenitiesEditor({
  villaId,
  initialQuantities,
  initialCustoms,
}: Props) {
  const t = useTranslations("amenities");
  const router = useRouter();

  const [quantities, setQuantities] = useState<Record<string, number>>(initialQuantities);
  const [customs, setCustoms] = useState<Record<string, CustomRow[]>>(() => {
    const map: Record<string, CustomRow[]> = {};
    for (const c of initialCustoms) {
      (map[c.category] ??= []).push({ label: c.label, labelKo: c.labelKo, quantity: c.quantity });
    }
    return map;
  });
  const [activeTab, setActiveTab] = useState<AmenityCategoryKey>("KITCHEN");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftQty, setDraftQty] = useState(1);
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

  function switchTab(category: AmenityCategoryKey) {
    setActiveTab(category);
    setDraftLabel("");
    setDraftQty(1);
  }

  function setCustomQty(category: AmenityCategoryKey, index: number, quantity: number) {
    setCustoms((prev) => {
      const rows = [...(prev[category] ?? [])];
      const row = rows[index];
      if (!row) return prev;
      rows[index] = { ...row, quantity: Math.min(99, Math.max(1, quantity)) };
      return { ...prev, [category]: rows };
    });
  }

  function removeCustom(category: AmenityCategoryKey, index: number) {
    setCustoms((prev) => {
      const rows = [...(prev[category] ?? [])];
      rows.splice(index, 1);
      return { ...prev, [category]: rows };
    });
  }

  function handleAddCustom() {
    const label = draftLabel.trim().slice(0, CUSTOM_LABEL_MAX);
    if (!label) return;
    setCustoms((prev) => {
      const rows = prev[activeTab] ?? [];
      if (rows.length >= CUSTOM_MAX) return prev;
      // 관리자 신규 추가 → labelKo null(서버 번역 파이프라인이 customLabelKo 채움)
      return {
        ...prev,
        [activeTab]: [...rows, { label, labelKo: null, quantity: Math.min(99, Math.max(1, draftQty)) }],
      };
    });
    setDraftLabel("");
    setDraftQty(1);
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const payload: {
      category: string;
      itemKey: string;
      quantity: number;
      customLabel?: string;
    }[] = [];
    // ① 사전 항목
    for (const [key, quantity] of Object.entries(quantities)) {
      if (quantity <= 0) continue;
      const idx = key.indexOf(":");
      const category = key.slice(0, idx);
      const itemKey = key.slice(idx + 1);
      // 미니바는 회사표준(#2b)으로 분리 — 빌라별 저장 대상 아님(전송 제외)
      if (category === "MINIBAR") continue;
      payload.push({ category, itemKey, quantity });
    }
    // ② custom 항목 — 반드시 되돌려 전송(전체교체 PATCH). customLabel은 vi 원문 그대로(번역본 금지).
    for (const [category, rows] of Object.entries(customs)) {
      if (category === "MINIBAR") continue;
      for (const row of rows) {
        const label = row.label.trim();
        if (!label || row.quantity <= 0) continue;
        payload.push({
          category,
          itemKey: "custom",
          quantity: Math.min(99, row.quantity),
          customLabel: label,
        });
      }
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

  const customSection = (
    <CustomSection
      rows={customs[activeTab] ?? []}
      draftLabel={draftLabel}
      draftQty={draftQty}
      onDraftLabel={setDraftLabel}
      onDraftQty={setDraftQty}
      onAdd={handleAddCustom}
      onQty={(i, q) => setCustomQty(activeTab, i, q)}
      onRemove={(i) => removeCustom(activeTab, i)}
      labels={{
        sectionTitle: t("customSectionTitle"),
        caption: t("customCaption"),
        placeholder: t("customPlaceholder"),
        add: t("addItem"),
        max: t("customMax", { max: CUSTOM_MAX }),
        remove: t("removeCustom"),
        pending: t("pendingTranslation"),
        decrease: t("decrease"),
        increase: t("increase"),
      }}
    />
  );

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
              onClick={() => switchTab(category)}
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

        {/* 직접 추가(custom) — 전 카테고리 공통(활성 탭 기준) */}
        {customSection}
      </div>
    </CollapsibleCard>
  );
}

interface CustomLabels {
  sectionTitle: string;
  caption: string;
  placeholder: string;
  add: string;
  max: string;
  remove: string;
  pending: string;
  decrease: string;
  increase: string;
}

/** 직접입력(custom) 섹션 — 추가 폼 + 추가된 항목 리스트(번역 병기·수량·삭제) */
function CustomSection({
  rows,
  draftLabel,
  draftQty,
  onDraftLabel,
  onDraftQty,
  onAdd,
  onQty,
  onRemove,
  labels,
}: {
  rows: CustomRow[];
  draftLabel: string;
  draftQty: number;
  onDraftLabel: (v: string) => void;
  onDraftQty: (n: number) => void;
  onAdd: () => void;
  onQty: (index: number, quantity: number) => void;
  onRemove: (index: number) => void;
  labels: CustomLabels;
}) {
  const atMax = rows.length >= CUSTOM_MAX;
  const canAdd = draftLabel.trim().length > 0 && !atMax;

  return (
    <div className="pt-4 border-t border-slate-800">
      <p className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">
        {labels.sectionTitle}
      </p>
      <p className="text-[11px] text-slate-500 mb-3">{labels.caption}</p>

      {/* 추가된 항목 리스트 */}
      {rows.length > 0 && (
        <div className="space-y-2 mb-3">
          {rows.map((row, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/60 border border-slate-800 px-3 py-2"
            >
              <div className="min-w-0 flex items-center gap-2">
                {row.labelKo ? (
                  <span className="text-sm font-medium text-slate-200 truncate">
                    {row.labelKo}
                    <span className="text-slate-500 font-normal"> ({row.label})</span>
                  </span>
                ) : (
                  <>
                    <span className="text-sm font-medium text-slate-200 truncate">{row.label}</span>
                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-bold">
                      {labels.pending}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Stepper
                  value={row.quantity}
                  min={1}
                  onChange={(q) => onQty(i, q)}
                  ariaLabel={row.labelKo ?? row.label}
                  decreaseLabel={labels.decrease}
                  increaseLabel={labels.increase}
                />
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label={labels.remove}
                  className="w-8 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 추가 폼 — 텍스트 + 수량 + 추가 버튼 */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draftLabel}
          maxLength={CUSTOM_LABEL_MAX}
          disabled={atMax}
          onChange={(e) => onDraftLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (canAdd) onAdd();
            }
          }}
          placeholder={labels.placeholder}
          className="flex-1 min-w-0 h-9 rounded-lg bg-slate-900 border border-slate-700 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-admin-primary disabled:opacity-50"
        />
        <Stepper
          value={draftQty}
          min={1}
          onChange={onDraftQty}
          ariaLabel={labels.sectionTitle}
          decreaseLabel={labels.decrease}
          increaseLabel={labels.increase}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          className="shrink-0 h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 text-sm font-bold flex items-center gap-1 transition-colors"
        >
          <span className="material-symbols-outlined text-base">add</span>
          {labels.add}
        </button>
      </div>
      {atMax && <p className="mt-2 text-[11px] text-amber-500">{labels.max}</p>}
    </div>
  );
}

/** 숫자 스테퍼 (−/숫자/+) — sales-editor와 동일 다크 스타일 */
function Stepper({
  value,
  min = 0,
  max = 99,
  onChange,
  ariaLabel,
  decreaseLabel = "−",
  increaseLabel = "+",
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  ariaLabel: string;
  decreaseLabel?: string;
  increaseLabel?: string;
}) {
  return (
    <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg h-9 flex-shrink-0" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label={decreaseLabel}
        className="w-8 h-9 text-slate-400 hover:text-white flex items-center justify-center"
      >
        <span className="material-symbols-outlined text-sm">remove</span>
      </button>
      <span className="w-7 text-center text-sm font-bold text-slate-100 tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label={increaseLabel}
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
