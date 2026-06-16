// lib/service-order 순수 로직 테스트 (T7.1, Phase 2)
import { describe, it, expect } from "vitest";
import {
  canTransitionService,
  assertServiceTransition,
  InvalidServiceTransitionError,
  isServiceType,
  isServiceOrderStatus,
  validateServiceOrderInput,
  computeServiceMarginKrw,
  SERVICE_TYPES,
  SERVICE_ORDER_STATUSES,
  type ServiceOrderInput,
} from "./service-order";

const baseInput: ServiceOrderInput = {
  type: "BBQ",
  costVnd: 1_500_000n,
  priceKrw: 120_000,
  serviceDate: "2026-07-15",
  vendorName: "Quán BBQ Phú Quốc",
  note: "통돼지 1마리",
};

describe("타입·상태 가드", () => {
  it("SERVICE_TYPES 5종, STATUSES 4종", () => {
    expect([...SERVICE_TYPES]).toEqual(["BBQ", "TICKET", "GUIDE", "CAR_RENTAL", "BREAKFAST"]);
    expect([...SERVICE_ORDER_STATUSES]).toEqual([
      "REQUESTED",
      "CONFIRMED",
      "DELIVERED",
      "CANCELLED",
    ]);
  });
  it("isServiceType / isServiceOrderStatus", () => {
    expect(isServiceType("BBQ")).toBe(true);
    expect(isServiceType("MASSAGE")).toBe(false);
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

describe("validateServiceOrderInput", () => {
  it("정상 입력 — 오류 0", () => {
    expect(validateServiceOrderInput(baseInput)).toEqual([]);
  });
  it("serviceDate·vendor·note 생략(null) 허용", () => {
    expect(
      validateServiceOrderInput({
        ...baseInput,
        serviceDate: null,
        vendorName: null,
        note: null,
      })
    ).toEqual([]);
    expect(validateServiceOrderInput({ ...baseInput, serviceDate: "" })).toEqual([]);
  });
  it("잘못된 type", () => {
    expect(
      validateServiceOrderInput({ ...baseInput, type: "SPA" as never })
    ).toContain("INVALID_TYPE");
  });
  it("음수 원가 / BigInt 아님", () => {
    expect(validateServiceOrderInput({ ...baseInput, costVnd: -1n })).toContain(
      "NEGATIVE_COST"
    );
    expect(
      validateServiceOrderInput({ ...baseInput, costVnd: 1000 as never })
    ).toContain("NEGATIVE_COST");
  });
  it("판매가 — 정수 아님/음수", () => {
    expect(validateServiceOrderInput({ ...baseInput, priceKrw: -100 })).toContain(
      "INVALID_PRICE"
    );
    expect(validateServiceOrderInput({ ...baseInput, priceKrw: 1.5 })).toContain(
      "INVALID_PRICE"
    );
  });
  it("실존하지 않는 serviceDate", () => {
    expect(
      validateServiceOrderInput({ ...baseInput, serviceDate: "2026-02-31" })
    ).toContain("INVALID_SERVICE_DATE");
    expect(
      validateServiceOrderInput({ ...baseInput, serviceDate: "07/15/2026" })
    ).toContain("INVALID_SERVICE_DATE");
  });
  it("vendor/note 길이 초과", () => {
    expect(
      validateServiceOrderInput({ ...baseInput, vendorName: "a".repeat(101) })
    ).toContain("VENDOR_TOO_LONG");
    expect(
      validateServiceOrderInput({ ...baseInput, note: "a".repeat(501) })
    ).toContain("NOTE_TOO_LONG");
  });
  it("0원 원가·판매가 허용 (무료 서비스)", () => {
    expect(
      validateServiceOrderInput({ ...baseInput, costVnd: 0n, priceKrw: 0 })
    ).toEqual([]);
  });
});

describe("computeServiceMarginKrw (판매가 KRW − 원가 VND→KRW)", () => {
  it("정상 마진 — fx 1 KRW = 18 VND, 원가 1,800,000₫ → 100,000원, 판매가 120,000원 → 마진 20,000원", () => {
    expect(computeServiceMarginKrw(1_800_000n, 120_000, "18")).toBe(20_000);
  });
  it("역마진(음수) 가능", () => {
    // 원가 1,800,000₫ → 100,000원, 판매가 80,000원 → -20,000원
    expect(computeServiceMarginKrw(1_800_000n, 80_000, "18")).toBe(-20_000);
  });
  it("원가 0 → 마진 = 판매가 전액", () => {
    expect(computeServiceMarginKrw(0n, 50_000, "18")).toBe(50_000);
  });
  it("잘못된 환율 형식은 거부(RangeError 전파)", () => {
    expect(() => computeServiceMarginKrw(1_000_000n, 50_000, "abc")).toThrow(RangeError);
  });
});
