"use client";

// 빌라별 미니바 비치수량 편집기 (#2c) — 냉장고 크기·현재 재고에 맞춰 "수량만" 조정.
//   ★ 가격(단가)은 회사표준이라 표시 전용이다(서버가 priceLabel 문자열로 전달, finance 권한 없으면 null → 미표시).
//   PATCH /api/villas/[id]/minibar-stock. 표준과 같은 수량은 서버가 오버라이드를 제거(이후 표준 변경 자동 추종).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import CollapsibleCard from "@/components/admin/collapsible-card";

export interface MinibarStockItem {
  id: string;
  label: string;
  standardQty: number; // 회사표준 기본 비치 수량
  qty: number; // 이 빌라의 현재 적용 수량(오버라이드 없으면 standardQty)
  priceLabel: string | null; // 회사표준 단가 표시문자열 — finance 권한 없으면 null
}

export default function MinibarStockEditor({
  villaId,
  items,
}: {
  villaId: string;
  items: MinibarStockItem[];
}) {
  const t = useTranslations("adminVillas.detail");
  const router = useRouter();

  const [qtyMap, setQtyMap] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.id, i.qty]))
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const qtyOf = (id: string, fallback: number) => qtyMap[id] ?? fallback;
  const setQty = (id: string, q: number) =>
    setQtyMap((prev) => ({ ...prev, [id]: Math.max(0, Math.min(9999, q)) }));

  const dirty = items.some((i) => qtyOf(i.id, i.qty) !== i.qty);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/villas/${villaId}/minibar-stock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stocks: items.map((i) => ({ minibarItemId: i.id, qty: qtyOf(i.id, i.standardQty) })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("minibarCard.saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("minibarCard.saveError") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard
      title={t("minibarCard.title")}
      icon="liquor"
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
            disabled={saving || !dirty}
            className="px-4 py-2 rounded-lg bg-admin-primary hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-all whitespace-nowrap flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            {saving ? t("minibarCard.saving") : t("minibarCard.save")}
          </button>
        </>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-admin-muted py-6 text-center">{t("minibarCard.empty")}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-slate-500">{t("minibarCard.editHint")}</p>
            <Link
              href="/settings/minibar"
              className="text-xs text-admin-primary hover:underline whitespace-nowrap shrink-0"
            >
              {t("minibarCard.manageLink")}
            </Link>
          </div>
          <ul className="divide-y divide-slate-800">
            {items.map((item) => {
              const q = qtyOf(item.id, item.qty);
              const overridden = q !== item.standardQty;
              return (
                <li key={item.id} className="flex items-center gap-3 py-2.5">
                  <span className="material-symbols-outlined text-slate-500 text-lg shrink-0">
                    liquor
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-200 truncate">{item.label}</p>
                    <p className="text-[11px] text-slate-500">
                      {overridden ? (
                        <span className="text-amber-500/90">
                          {t("minibarCard.standardHint", { n: item.standardQty })}
                        </span>
                      ) : (
                        t("minibarCard.standardTag")
                      )}
                      {item.priceLabel && (
                        <span className="ml-2 text-admin-primary/80 tabular-nums">
                          {item.priceLabel}
                        </span>
                      )}
                    </p>
                  </div>
                  <Stepper value={q} onChange={(n) => setQty(item.id, n)} ariaLabel={item.label} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </CollapsibleCard>
  );
}

/** 수량 스테퍼 (−/숫자/+) — amenities-editor와 동일 다크 스타일 */
function Stepper({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="flex items-center bg-slate-900 border border-slate-700 rounded-lg h-9 flex-shrink-0"
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        aria-label="−"
        className="w-8 h-9 text-slate-400 hover:text-white flex items-center justify-center"
      >
        <span className="material-symbols-outlined text-sm">remove</span>
      </button>
      <span className="w-9 text-center text-sm font-bold text-slate-100 tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(9999, value + 1))}
        aria-label="+"
        className="w-8 h-9 text-slate-400 hover:text-white flex items-center justify-center"
      >
        <span className="material-symbols-outlined text-sm">add</span>
      </button>
    </div>
  );
}
