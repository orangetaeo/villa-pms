import { describe, expect, it } from "vitest";
import {
  planRecover,
  MINIBAR_MOVEMENT_KINDS,
  currentOnHand,
  computeConsumptionFromRemaining,
} from "./minibar-inventory";

describe("planRecover — 전환 회수 계획 (ADR-0021 D6)", () => {
  it("onHand>0 품목마다 qtyDelta=−onHand 회수 라인", () => {
    expect(
      planRecover([
        { minibarItemId: "mb_cola", onHand: 5 },
        { minibarItemId: "mb_water", onHand: 3 },
      ])
    ).toEqual([
      { minibarItemId: "mb_cola", qtyDelta: -5 },
      { minibarItemId: "mb_water", qtyDelta: -3 },
    ]);
  });

  it("onHand 0·음수 품목은 제외(회수 대상 아님)", () => {
    expect(
      planRecover([
        { minibarItemId: "mb_cola", onHand: 0 },
        { minibarItemId: "mb_water", onHand: -2 },
        { minibarItemId: "mb_juice", onHand: 4 },
      ])
    ).toEqual([{ minibarItemId: "mb_juice", qtyDelta: -4 }]);
  });

  it("빈 입력 → 빈 배열", () => {
    expect(planRecover([])).toEqual([]);
  });

  it("전부 0/음수 → 빈 배열", () => {
    expect(
      planRecover([
        { minibarItemId: "a", onHand: 0 },
        { minibarItemId: "b", onHand: -1 },
      ])
    ).toEqual([]);
  });

  it("회수 라인을 현재고에 더하면 0이 된다(전량 회수 보장)", () => {
    const onHand = 7;
    const [line] = planRecover([{ minibarItemId: "x", onHand }]);
    expect(currentOnHand([onHand, line.qtyDelta])).toBe(0);
  });
});

describe("computeConsumptionFromRemaining — 남은수량→소비량 역산", () => {
  it("remaining = par → 0 (소비 없음)", () => {
    expect(computeConsumptionFromRemaining(5, 5)).toBe(0);
  });

  it("remaining = 0 → par (전량 소비)", () => {
    expect(computeConsumptionFromRemaining(5, 0)).toBe(5);
  });

  it("정상: par − remaining", () => {
    expect(computeConsumptionFromRemaining(5, 3)).toBe(2);
    expect(computeConsumptionFromRemaining(10, 1)).toBe(9);
  });

  it("remaining > par → 0 (clamp, 음수 소비 방지)", () => {
    expect(computeConsumptionFromRemaining(5, 8)).toBe(0);
  });

  it("remaining 음수 → 거부(throw)", () => {
    expect(() => computeConsumptionFromRemaining(5, -1)).toThrow(RangeError);
  });

  it("par 0 + remaining 0 → 0", () => {
    expect(computeConsumptionFromRemaining(0, 0)).toBe(0);
  });

  it("비정수 입력 → 거부(throw)", () => {
    expect(() => computeConsumptionFromRemaining(5, 2.5)).toThrow(RangeError);
    expect(() => computeConsumptionFromRemaining(5.5, 2)).toThrow(RangeError);
  });
});

describe("MINIBAR_MOVEMENT_KINDS — RECOVER 포함", () => {
  it("RECOVER가 표시용 종류 목록에 포함된다", () => {
    expect(MINIBAR_MOVEMENT_KINDS).toContain("RECOVER");
    expect(MINIBAR_MOVEMENT_KINDS).toEqual(["RESTOCK", "CONSUME", "ADJUST", "RECOVER"]);
  });
});
