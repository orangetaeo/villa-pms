// lib/service-order 상태 전이 상태머신 테스트
// (T7.1의 판매 입력검증·마진 테스트는 해당 BE가 ADR-0019/0023 카탈로그 시스템으로
//  대체·제거되며 함께 제거됨. 양 시스템이 공유하는 전이 로직만 검증한다.)
import { describe, it, expect } from "vitest";
import {
  canTransitionService,
  assertServiceTransition,
  InvalidServiceTransitionError,
  isServiceOrderStatus,
  SERVICE_ORDER_STATUSES,
} from "./service-order";

describe("상태 가드", () => {
  it("STATUSES 4종", () => {
    expect([...SERVICE_ORDER_STATUSES]).toEqual([
      "REQUESTED",
      "CONFIRMED",
      "DELIVERED",
      "CANCELLED",
    ]);
  });
  it("isServiceOrderStatus", () => {
    expect(isServiceOrderStatus("DELIVERED")).toBe(true);
    expect(isServiceOrderStatus("DONE")).toBe(false);
  });
});

describe("상태 전이표", () => {
  it("정상 진행 경로", () => {
    expect(canTransitionService("REQUESTED", "CONFIRMED")).toBe(true);
    expect(canTransitionService("CONFIRMED", "DELIVERED")).toBe(true);
    expect(canTransitionService("REQUESTED", "CANCELLED")).toBe(true);
    expect(canTransitionService("CONFIRMED", "CANCELLED")).toBe(true);
  });
  it("역방향·건너뛰기·종결 덮어쓰기 차단", () => {
    expect(canTransitionService("REQUESTED", "DELIVERED")).toBe(false); // 건너뛰기
    expect(canTransitionService("CONFIRMED", "REQUESTED")).toBe(false); // 역방향
    expect(canTransitionService("DELIVERED", "CANCELLED")).toBe(false); // 종결
    expect(canTransitionService("CANCELLED", "CONFIRMED")).toBe(false); // 종결
    expect(canTransitionService("REQUESTED", "REQUESTED")).toBe(false); // 자기 전이
  });
  it("assertServiceTransition — 위반 시 InvalidServiceTransitionError", () => {
    expect(() => assertServiceTransition("REQUESTED", "CONFIRMED")).not.toThrow();
    expect(() => assertServiceTransition("DELIVERED", "CANCELLED")).toThrow(
      InvalidServiceTransitionError
    );
  });
});
