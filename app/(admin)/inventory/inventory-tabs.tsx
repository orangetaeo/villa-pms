"use client";

// 재고 화면 탭 래퍼 (2026-06-26) — "재고 현황"(빌라별 실재고) + "미니바 품목"(회사표준 CRUD).
//   미니바 = 우리 회사 재고. 업무 순서: 미니바 품목 탭에서 팔 품목·판매가·입고가 입력 → 재고 현황 탭에서 빌라별 입고·관리.
//   품목 관리 탭은 가격 설정 권한(canManageItems=canSetPrice)일 때만 노출(STAFF는 현황만).
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { InventoryItemRow, InventorySummary } from "@/lib/minibar-inventory-load";
import InventoryClient from "./inventory-client";
import MinibarManager, { type MinibarRow } from "./minibar-manager";

type Tab = "stock" | "items";

export default function InventoryTabs({
  rows,
  summary,
  villaOptions,
  itemOptions,
  showCost,
  minibarItems,
  canManageItems,
}: {
  rows: InventoryItemRow[];
  summary: InventorySummary;
  villaOptions: { id: string; name: string }[];
  itemOptions: { id: string; label: string }[];
  showCost: boolean;
  minibarItems: MinibarRow[];
  canManageItems: boolean;
}) {
  const t = useTranslations("inventory");
  const [tab, setTab] = useState<Tab>("stock");

  return (
    <div className="space-y-5">
      {/* 탭 바 — 품목 관리 권한 없으면 단일 탭(현황만) */}
      {canManageItems && (
        <div className="flex items-center gap-1 rounded-xl bg-admin-card border border-slate-800 p-1 w-fit">
          {(["stock", "items"] as const).map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              aria-pressed={tab === tb}
              className={
                tab === tb
                  ? "flex items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white"
                  : "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
              }
            >
              <span className="material-symbols-outlined text-[18px]">
                {tb === "stock" ? "inventory_2" : "liquor"}
              </span>
              {tb === "stock" ? t("tab.stock") : t("tab.items")}
            </button>
          ))}
        </div>
      )}

      {tab === "stock" || !canManageItems ? (
        <InventoryClient
          rows={rows}
          summary={summary}
          villaOptions={villaOptions}
          itemOptions={itemOptions}
          showCost={showCost}
        />
      ) : (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">{t("itemsTitle")}</h1>
            <p className="text-sm text-slate-500 mt-1">{t("itemsSubtitle")}</p>
          </div>
          <MinibarManager initialItems={minibarItems} />
        </div>
      )}
    </div>
  );
}
