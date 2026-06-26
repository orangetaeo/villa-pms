// lib/minibar-inventory.ts — 미니바 실재고 순수 로직 (ADR-0019 S1)
//
// 현재고는 캐시 컬럼이 아니라 MinibarStockMovement 원장의 ΣqtyDelta로 산출한다
//   (VillaMinibarStock 행은 표준 추종 시 삭제되는 sparse 구조라 현재고 캐시 불가 — 원장 단일소스).
//   비치목표(par) = 빌라 오버라이드(VillaMinibarStock.qty) ?? 회사표준(MinibarItem.stockQty).
//   부족(low) = 현재고 < par. 부족수량 = max(0, par − 현재고).
//
// ★ 원가(unitCostVnd)는 운영자(canViewFinance) 전용 — 공급자·공개 라우트 비노출(마진 비공개 원칙2).
//   이 모듈은 순수(DB·auth 무의존). DB 집계(groupBy)·권한 게이트는 호출측(API/page).

import { MINIBAR_VND_DIGITS } from "./minibar";

export type MinibarMovementKind = "RESTOCK" | "CONSUME" | "ADJUST";

export const MINIBAR_MOVEMENT_KINDS: readonly MinibarMovementKind[] = [
  "RESTOCK",
  "CONSUME",
  "ADJUST",
] as const;

/** 비치 목표(par) — 빌라 오버라이드 우선, 없으면 회사표준 stockQty. */
export function effectivePar(
  overrideQty: number | null | undefined,
  standardStockQty: number
): number {
  return overrideQty ?? standardStockQty;
}

/** 현재고 = 이동 원장 delta 합(입고+ / 소모·보정−). 빈 배열이면 0. */
export function currentOnHand(deltas: number[]): number {
  return deltas.reduce((sum, d) => sum + d, 0);
}

/** 부족 여부 — 현재고가 비치 목표 미만. par<=0이면 부족 아님. */
export function isLowStock(onHand: number, par: number): boolean {
  return par > 0 && onHand < par;
}

/** 부족 수량 = max(0, par − 현재고) — "채워야 할 개수". */
export function shortageQty(onHand: number, par: number): number {
  return Math.max(0, par - onHand);
}

/**
 * 입고 가능 최대 수량 = max(0, par − 현재고).
 *   미니바는 회사 재고이므로 입고(RESTOCK)는 비치 목표(par)까지만 — 초과 비치 금지(2026-06-26 테오).
 *   부족 수량과 같은 값이지만, "입고 상한"이라는 의미로 별도 함수.
 */
export function maxRestockQty(onHand: number, par: number): number {
  return Math.max(0, par - onHand);
}

/**
 * 입고 후 현재고가 비치 목표를 초과하는가 — 입고(RESTOCK) 검증용.
 *   true면 그 입고는 거부(현재고 + 입고수량 > par). par<=0이면 모든 양수 입고가 초과.
 *   ★ ADJUST(실사·분실 보정)에는 적용하지 않는다 — 입고에만 상한.
 */
export function restockExceedsPar(onHand: number, qtyDelta: number, par: number): boolean {
  return onHand + qtyDelta > par;
}

// ── 입고/보정 입력 검증 (순수) ──────────────────────────────────────────────
//   RESTOCK(입고): qtyDelta 정수 > 0, unitCostVnd 선택(VND 동 정수 문자열).
//   ADJUST(보정): qtyDelta 정수 ≠ 0(음수 허용 — 실사·분실), 원가 불가.
//   CONSUME은 체크아웃 경로 전용(여기서 입력 금지).

export interface RestockLineInput {
  minibarItemId: string;
  type: MinibarMovementKind;
  qtyDelta: number;
  /** VND 동 단위 매입 단가(문자열) — RESTOCK일 때만. canViewFinance 게이트는 호출측. */
  unitCostVnd?: string | null;
}

export type RestockLineError =
  | "INVALID_ITEM"
  | "INVALID_TYPE"
  | "INVALID_QTY"
  | "INVALID_COST";

/** 입고/보정 라인 검증 — 위반 코드 배열(빈 배열이면 통과). 순수. */
export function validateRestockLine(line: RestockLineInput): RestockLineError[] {
  const errors: RestockLineError[] = [];
  if (typeof line.minibarItemId !== "string" || line.minibarItemId.length === 0) {
    errors.push("INVALID_ITEM");
  }
  if (line.type !== "RESTOCK" && line.type !== "ADJUST") {
    errors.push("INVALID_TYPE");
  }
  if (!Number.isInteger(line.qtyDelta)) {
    errors.push("INVALID_QTY");
  } else if (line.type === "RESTOCK" && line.qtyDelta <= 0) {
    errors.push("INVALID_QTY"); // 입고는 양수만
  } else if (line.type === "ADJUST" && line.qtyDelta === 0) {
    errors.push("INVALID_QTY"); // 보정은 0 금지(음수/양수)
  }
  // 원가는 RESTOCK + 값이 있을 때만 검증. ADJUST에 원가가 오면 무효.
  if (line.unitCostVnd != null && line.unitCostVnd !== "") {
    if (line.type !== "RESTOCK" || !MINIBAR_VND_DIGITS.test(line.unitCostVnd)) {
      errors.push("INVALID_COST");
    }
  }
  return errors;
}
