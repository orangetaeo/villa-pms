"use client";

// 미니바 재고 현황 + 입고 폼 (b18) — 다크 운영자.
//   현황 표: 빌라 | 품목 | 비치 목표 | 현재고 | 상태 | 입고. 필터(전체/부족만). 부족 행은 현재고 red bold.
//   입고 폼(우측 sticky): 빌라·품목·수량 stepper·유형(입고/보정)·매입 단가(canViewFinance만)·메모.
//   ★ 매입 단가 입력칸은 showCost(서버 canViewFinance)일 때만 렌더 — STAFF 페이로드엔 단가 자체가 없음(클라 게이트 아님).
//   POST /api/villas/[id]/minibar-restock 후 router.refresh()로 원장 합산 재조회.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { InventoryItemRow, InventorySummary } from "@/lib/minibar-inventory-load";

type Mode = "RESTOCK" | "ADJUST";

export default function InventoryClient({
  rows,
  summary,
  villaOptions,
  itemOptions,
  showCost,
}: {
  rows: InventoryItemRow[];
  summary: InventorySummary;
  villaOptions: { id: string; name: string }[];
  itemOptions: { id: string; label: string }[];
  showCost: boolean;
}) {
  const t = useTranslations("inventory");
  const router = useRouter();

  const [lowOnly, setLowOnly] = useState(false);

  // 입고 폼 상태
  const [villaId, setVillaId] = useState(villaOptions[0]?.id ?? "");
  const [itemId, setItemId] = useState(itemOptions[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("RESTOCK");
  const [qty, setQty] = useState(10);
  const [unitCost, setUnitCost] = useState(""); // VND digits only (쉼표 표시 분리)
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const visibleRows = useMemo(
    () => (lowOnly ? rows.filter((r) => r.low) : rows),
    [rows, lowOnly]
  );

  const costDigits = unitCost.replace(/\D/g, "");
  const costDisplay = costDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // 입고: 양수만. 보정: 0 금지(음수 허용).
  const qtyValid = mode === "RESTOCK" ? qty > 0 : qty !== 0;
  const canSubmit = villaId !== "" && itemId !== "" && qtyValid && !submitting;

  // 표의 "입고" 버튼 → 해당 빌라·품목으로 폼 프리필 + 부족수량 만큼 기본 수량
  const prefillRestock = (r: InventoryItemRow) => {
    setVillaId(r.villaId);
    setItemId(r.minibarItemId);
    setMode("RESTOCK");
    setQty(r.shortage > 0 ? r.shortage : 1);
    setMessage(null);
  };

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const line: {
        minibarItemId: string;
        type: Mode;
        qtyDelta: number;
        unitCostVnd?: string;
      } = { minibarItemId: itemId, type: mode, qtyDelta: qty };
      // 매입 단가는 RESTOCK + 권한자 + 값 있을 때만 전송(서버도 동일 게이트)
      if (mode === "RESTOCK" && showCost && costDigits !== "") {
        line.unitCostVnd = costDigits;
      }
      const res = await fetch(`/api/villas/${villaId}/minibar-restock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: [line], note: note.trim() || null }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = (await res.json()) as { recorded: number; costUpdated: number };
      setMessage({
        ok: true,
        text:
          data.costUpdated > 0
            ? t("form.savedCost", { n: data.recorded })
            : t("form.saved"),
      });
      setUnitCost("");
      setNote("");
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("form.error") });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
        <p className="text-sm text-slate-500 mt-1">{t("subtitle")}</p>
      </div>

      {/* 부족 경보 배너 */}
      {summary.lowItemCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-5 py-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-red-400 shrink-0">warning</span>
          <p className="text-sm font-semibold text-red-300 [word-break:keep-all]">
            <span className="font-bold">{t("banner.title")}</span>
            {" · "}
            {summary.lowItemCount > 1
              ? t("banner.body", { items: summary.lowItemCount, villas: summary.lowVillaCount })
              : t("banner.bodyOne")}
          </p>
          {!lowOnly && (
            <button
              type="button"
              onClick={() => setLowOnly(true)}
              className="ml-auto text-xs font-bold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg px-3 py-1.5 whitespace-nowrap"
            >
              {t("filterLow")}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* 표 (2 cols) */}
        <div className="xl:col-span-2 bg-admin-card border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800">
            <FilterTab active={!lowOnly} onClick={() => setLowOnly(false)}>
              {t("filterAll")}
            </FilterTab>
            <FilterTab active={lowOnly} onClick={() => setLowOnly(true)}>
              {t("filterLow")}
            </FilterTab>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-xs border-b border-slate-800">
                <tr>
                  <th className="text-left font-semibold px-5 py-3">{t("col.villa")}</th>
                  <th className="text-left font-semibold px-3 py-3">{t("col.item")}</th>
                  <th className="text-right font-semibold px-3 py-3">{t("col.par")}</th>
                  <th className="text-right font-semibold px-3 py-3">{t("col.onHand")}</th>
                  <th className="text-center font-semibold px-3 py-3">{t("col.status")}</th>
                  <th className="text-right font-semibold px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                      {lowOnly ? t("emptyLow") : t("empty")}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => (
                    <tr
                      key={`${r.villaId}::${r.minibarItemId}`}
                      className="hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-3 font-medium text-white">{r.villaName}</td>
                      <td className="px-3 py-3 text-slate-300">{r.itemLabel}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-300">{r.par}</td>
                      <td
                        className={
                          r.low
                            ? "px-3 py-3 text-right tabular-nums font-bold text-red-400"
                            : "px-3 py-3 text-right tabular-nums text-slate-200"
                        }
                      >
                        {r.onHand}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {r.low ? (
                          <span className="bg-red-500/15 text-red-400 text-[11px] font-bold px-2.5 py-1 rounded-full">
                            {t("status.low")}
                          </span>
                        ) : (
                          <span className="bg-emerald-500/15 text-emerald-400 text-[11px] font-bold px-2.5 py-1 rounded-full">
                            {t("status.ok")}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => prefillRestock(r)}
                          className={
                            r.low
                              ? "text-xs font-bold bg-admin-primary hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 whitespace-nowrap"
                              : "text-xs font-bold border border-slate-700 hover:bg-slate-800 text-slate-300 rounded-lg px-3 py-1.5 whitespace-nowrap"
                          }
                        >
                          {t("restockBtn")}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 입고 폼 (우측) */}
        <div className="bg-admin-card border border-slate-800 rounded-xl p-5 space-y-4 xl:sticky xl:top-24">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-admin-primary">add_box</span>
            <h3 className="font-bold text-white">{t("form.title")}</h3>
          </div>

          {/* 유형 토글 — 입고 / 보정 */}
          <div className="flex items-center gap-0.5 rounded-lg bg-slate-900 p-0.5">
            {(["RESTOCK", "ADJUST"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  mode === m
                    ? "flex-1 rounded-md bg-admin-primary px-2.5 py-1.5 text-xs font-bold text-white"
                    : "flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white"
                }
              >
                {m === "RESTOCK" ? t("form.modeRestock") : t("form.modeAdjust")}
              </button>
            ))}
          </div>

          <Field label={t("form.villa")}>
            <select
              value={villaId}
              onChange={(e) => setVillaId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:border-admin-primary focus:ring-0"
            >
              {villaOptions.length === 0 && <option value="">{t("form.selectVilla")}</option>}
              {villaOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("form.item")}>
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:border-admin-primary focus:ring-0"
            >
              {itemOptions.length === 0 && <option value="">{t("form.selectItem")}</option>}
              {itemOptions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("form.qty")}>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQty((q) => q - 1)}
                aria-label="−"
                className="w-10 h-10 rounded-lg border border-slate-700 text-slate-300 text-lg hover:bg-slate-800 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">remove</span>
              </button>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(Math.trunc(Number(e.target.value) || 0))}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-center text-lg font-bold text-white tabular-nums focus:border-admin-primary focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                aria-label="+"
                className="w-10 h-10 rounded-lg bg-admin-primary text-white text-lg hover:bg-blue-500 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">add</span>
              </button>
            </div>
            {mode === "ADJUST" && (
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{t("form.adjustHint")}</p>
            )}
          </Field>

          {/* 매입 단가 — canViewFinance(showCost) + 입고 유형일 때만 (마진 비공개) */}
          {showCost && mode === "RESTOCK" && (
            <Field
              label={
                <span className="flex items-center gap-1.5">
                  {t("form.unitCost")}
                  <span
                    className="material-symbols-outlined text-[14px] text-slate-500"
                    title={t("form.unitCost")}
                  >
                    visibility
                  </span>
                </span>
              }
            >
              <div className="relative">
                <input
                  inputMode="numeric"
                  value={costDisplay}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-3 pr-8 py-2.5 text-sm text-white tabular-nums text-right focus:border-admin-primary focus:ring-0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">₫</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex gap-2 mt-2">
                <span className="material-symbols-outlined text-slate-500 text-[18px]">lightbulb</span>
                <p className="text-[11px] text-slate-400 leading-relaxed">{t("form.unitCostHint")}</p>
              </div>
            </Field>
          )}

          <Field label={t("form.note")}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:border-admin-primary focus:ring-0"
            />
          </Field>

          {message && (
            <p
              role="status"
              className={`text-xs font-medium ${message.ok ? "text-emerald-400" : "text-red-400"}`}
            >
              {message.text}
            </p>
          )}
          {!qtyValid && (
            <p className="text-xs text-amber-400">{t("form.invalidQty")}</p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full h-12 bg-admin-primary hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-colors"
          >
            {submitting ? t("form.submitting") : t("form.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "text-xs font-bold rounded-lg px-3 py-1.5 bg-admin-primary text-white"
          : "text-xs font-medium rounded-lg px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-800"
      }
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-400 block">{label}</label>
      {children}
    </div>
  );
}
