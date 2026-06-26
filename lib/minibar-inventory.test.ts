import { describe, expect, it } from "vitest";
import {
  planRecover,
  MINIBAR_MOVEMENT_KINDS,
  currentOnHand,
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

describe("MINIBAR_MOVEMENT_KINDS — RECOVER 포함", () => {
  it("RECOVER가 표시용 종류 목록에 포함된다", () => {
    expect(MINIBAR_MOVEMENT_KINDS).toContain("RECOVER");
    expect(MINIBAR_MOVEMENT_KINDS).toEqual(["RESTOCK", "CONSUME", "ADJUST", "RECOVER"]);
  });
});
