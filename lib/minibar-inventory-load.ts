// lib/minibar-inventory-load.ts — 미니바 실재고 매트릭스 로더 (ADR-0019 S1 운영자 UI)
//
// 재고 현황 페이지(/inventory)와 대시보드 부족 배너가 공유한다(부족 집계 단일 로직).
//   현재고(빌라×품목) = MinibarStockMovement 원장 ΣqtyDelta (없으면 0).
//   par(비치목표) = VillaMinibarStock.qty(오버라이드) ?? MinibarItem.stockQty(회사표준).
//   부족 = isLowStock(onHand, par). 순수 판정은 lib/minibar-inventory.ts 재사용.
//
// ★ 마진 비공개(원칙2): 원가(unitCostVnd)는 이 로더에 포함하지 않는다. 화면은 현재고·par·상태만 본다.
//   (매입 단가는 입고 시점 입력 전용 — canViewFinance 게이트는 API에서. 현황 표엔 원가 컬럼 없음.)

import type { PrismaClient } from "@prisma/client";
import {
  effectivePar,
  isLowStock,
  shortageQty,
} from "./minibar-inventory";
import { minibarItemName } from "./minibar";

export interface InventoryItemRow {
  villaId: string;
  villaName: string;
  minibarItemId: string;
  itemLabel: string;
  par: number;
  onHand: number;
  low: boolean;
  shortage: number;
}

export interface InventorySummary {
  /** 부족 품목(빌라×품목) 행 수 */
  lowItemCount: number;
  /** 부족 품목이 1개 이상인 빌라 수 */
  lowVillaCount: number;
}

export interface InventoryMatrix {
  rows: InventoryItemRow[];
  summary: InventorySummary;
}

/**
 * 전 ACTIVE 빌라 × 전 active MinibarItem 매트릭스 + 부족 집계.
 * locale은 품목 표시명(ko/vi) 폴백에만 사용.
 */
export async function loadInventoryMatrix(
  db: PrismaClient,
  locale: string
): Promise<InventoryMatrix> {
  const [villas, items, movementSums, overrides] = await Promise.all([
    db.villa.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: [{ complex: "asc" }, { name: "asc" }],
    }),
    db.minibarItem.findMany({
      where: { active: true },
      select: { id: true, nameKo: true, nameVi: true, stockQty: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    // 현재고 = 빌라×품목 ΣqtyDelta (원장 단일소스)
    db.minibarStockMovement.groupBy({
      by: ["villaId", "minibarItemId"],
      _sum: { qtyDelta: true },
    }),
    // 빌라별 비치목표 오버라이드 (없으면 회사표준 stockQty)
    db.villaMinibarStock.findMany({
      select: { villaId: true, minibarItemId: true, qty: true },
    }),
  ]);

  const key = (villaId: string, itemId: string) => `${villaId}::${itemId}`;

  const onHandMap = new Map<string, number>();
  for (const g of movementSums) {
    onHandMap.set(key(g.villaId, g.minibarItemId), g._sum.qtyDelta ?? 0);
  }
  const overrideMap = new Map<string, number>();
  for (const o of overrides) {
    overrideMap.set(key(o.villaId, o.minibarItemId), o.qty);
  }

  const rows: InventoryItemRow[] = [];
  const lowVillas = new Set<string>();
  let lowItemCount = 0;

  for (const villa of villas) {
    for (const item of items) {
      const k = key(villa.id, item.id);
      const par = effectivePar(overrideMap.get(k) ?? null, item.stockQty);
      const onHand = onHandMap.get(k) ?? 0;
      const low = isLowStock(onHand, par);
      if (low) {
        lowItemCount += 1;
        lowVillas.add(villa.id);
      }
      rows.push({
        villaId: villa.id,
        villaName: villa.name,
        minibarItemId: item.id,
        itemLabel: minibarItemName(item, locale),
        par,
        onHand,
        low,
        shortage: shortageQty(onHand, par),
      });
    }
  }

  return {
    rows,
    summary: { lowItemCount, lowVillaCount: lowVillas.size },
  };
}

/** 대시보드 배너용 경량 집계 — 부족 빌라/품목 수만(행 생성 없이 동일 로직). */
export async function loadInventoryShortageSummary(
  db: PrismaClient
): Promise<InventorySummary> {
  const { summary } = await loadInventoryMatrix(db, "ko");
  return summary;
}
