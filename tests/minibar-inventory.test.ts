import { describe, it, expect } from "vitest";
import {
  effectivePar,
  currentOnHand,
  isLowStock,
  shortageQty,
  maxRestockQty,
  restockExceedsPar,
  validateRestockLine,
  type RestockLineInput,
} from "@/lib/minibar-inventory";

describe("effectivePar", () => {
  it("빌라 오버라이드가 있으면 그 값", () => {
    expect(effectivePar(6, 4)).toBe(6);
    expect(effectivePar(0, 4)).toBe(0); // 0도 유효한 오버라이드
  });
  it("오버라이드 없으면 회사표준 stockQty", () => {
    expect(effectivePar(null, 4)).toBe(4);
    expect(effectivePar(undefined, 4)).toBe(4);
  });
});

describe("currentOnHand", () => {
  it("delta 합 — 입고+/소모·보정−", () => {
    expect(currentOnHand([])).toBe(0);
    expect(currentOnHand([10, -2, -3])).toBe(5);
    expect(currentOnHand([4, 4, -10])).toBe(-2); // 원장상 음수 가능(보정 전)
  });
});

describe("isLowStock / shortageQty", () => {
  it("현재고 < par 이면 부족", () => {
    expect(isLowStock(2, 4)).toBe(true);
    expect(isLowStock(4, 4)).toBe(false);
    expect(isLowStock(5, 4)).toBe(false);
  });
  it("par<=0이면 부족 아님", () => {
    expect(isLowStock(0, 0)).toBe(false);
    expect(isLowStock(-1, 0)).toBe(false);
  });
  it("부족수량 = max(0, par−현재고)", () => {
    expect(shortageQty(2, 4)).toBe(2);
    expect(shortageQty(4, 4)).toBe(0);
    expect(shortageQty(6, 4)).toBe(0);
    expect(shortageQty(-2, 4)).toBe(6);
  });
});

describe("maxRestockQty / restockExceedsPar — 비치 목표 초과 입고 차단", () => {
  it("입고 상한 = max(0, par − 현재고)", () => {
    expect(maxRestockQty(2, 4)).toBe(2); // 2개 더 넣어 목표 충족
    expect(maxRestockQty(4, 4)).toBe(0); // 이미 목표 → 입고 불가
    expect(maxRestockQty(6, 4)).toBe(0); // 초과 상태 → 입고 불가
    expect(maxRestockQty(-2, 4)).toBe(6);
  });
  it("입고 후 현재고가 par 초과면 true(거부)", () => {
    expect(restockExceedsPar(2, 2, 4)).toBe(false); // 2+2=4 = par, 허용
    expect(restockExceedsPar(2, 3, 4)).toBe(true); // 2+3=5 > 4, 거부
    expect(restockExceedsPar(4, 1, 4)).toBe(true); // 이미 목표인데 추가, 거부
    expect(restockExceedsPar(0, 4, 4)).toBe(false); // 0+4=4, 허용
  });
  it("par<=0이면 모든 양수 입고가 초과", () => {
    expect(restockExceedsPar(0, 1, 0)).toBe(true);
    expect(maxRestockQty(0, 0)).toBe(0);
  });
});

describe("validateRestockLine", () => {
  const base: RestockLineInput = { minibarItemId: "mb_1", type: "RESTOCK", qtyDelta: 5 };

  it("정상 입고(원가 포함) 통과", () => {
    expect(validateRestockLine({ ...base, unitCostVnd: "12000" })).toEqual([]);
  });
  it("정상 입고(원가 생략) 통과", () => {
    expect(validateRestockLine(base)).toEqual([]);
    expect(validateRestockLine({ ...base, unitCostVnd: null })).toEqual([]);
    expect(validateRestockLine({ ...base, unitCostVnd: "" })).toEqual([]);
  });
  it("빈 품목 거부", () => {
    expect(validateRestockLine({ ...base, minibarItemId: "" })).toContain("INVALID_ITEM");
  });
  it("잘못된 타입 거부", () => {
    expect(
      validateRestockLine({ ...base, type: "CONSUME" as never })
    ).toContain("INVALID_TYPE");
  });
  it("입고는 양수만 — 0·음수·소수 거부", () => {
    expect(validateRestockLine({ ...base, qtyDelta: 0 })).toContain("INVALID_QTY");
    expect(validateRestockLine({ ...base, qtyDelta: -3 })).toContain("INVALID_QTY");
    expect(validateRestockLine({ ...base, qtyDelta: 1.5 })).toContain("INVALID_QTY");
  });
  it("보정(ADJUST)은 음수 허용, 0은 거부", () => {
    expect(validateRestockLine({ minibarItemId: "mb_1", type: "ADJUST", qtyDelta: -2 })).toEqual([]);
    expect(validateRestockLine({ minibarItemId: "mb_1", type: "ADJUST", qtyDelta: 0 })).toContain("INVALID_QTY");
  });
  it("원가 형식 위반 거부(비숫자·과대자리)", () => {
    expect(validateRestockLine({ ...base, unitCostVnd: "12,000" })).toContain("INVALID_COST");
    expect(validateRestockLine({ ...base, unitCostVnd: "abc" })).toContain("INVALID_COST");
  });
  it("ADJUST에 원가가 오면 거부(원가는 입고 전용)", () => {
    expect(
      validateRestockLine({ minibarItemId: "mb_1", type: "ADJUST", qtyDelta: -1, unitCostVnd: "5000" })
    ).toContain("INVALID_COST");
  });
});
