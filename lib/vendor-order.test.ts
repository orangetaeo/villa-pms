// lib/vendor-order 순수 로직 테스트 (ADR-0023 S2)
import { describe, it, expect } from "vitest";
import {
  VENDOR_GATE_TRANSITIONS,
  VENDOR_GATE_STATUSES,
  canTransitionVendorGate,
  canDispatch,
  canConfirmCustomer,
  assertVendorResponse,
  isVendorGateStatus,
  InvalidVendorResponseError,
} from "./vendor-order";

describe("VENDOR_GATE_TRANSITIONS", () => {
  it("PENDING_VENDOR → ACCEPTED·REJECTED 허용", () => {
    expect(canTransitionVendorGate("PENDING_VENDOR", "VENDOR_ACCEPTED")).toBe(true);
    expect(canTransitionVendorGate("PENDING_VENDOR", "VENDOR_REJECTED")).toBe(true);
  });
  it("ACCEPTED·REJECTED는 종결(공급자측 재전이 불가)", () => {
    expect(VENDOR_GATE_TRANSITIONS.VENDOR_ACCEPTED).toEqual([]);
    expect(VENDOR_GATE_TRANSITIONS.VENDOR_REJECTED).toEqual([]);
    expect(canTransitionVendorGate("VENDOR_ACCEPTED", "VENDOR_REJECTED")).toBe(false);
    expect(canTransitionVendorGate("VENDOR_REJECTED", "VENDOR_ACCEPTED")).toBe(false);
    expect(canTransitionVendorGate("VENDOR_ACCEPTED", "PENDING_VENDOR")).toBe(false);
  });
});

describe("isVendorGateStatus", () => {
  it("enum 값만 true", () => {
    for (const s of VENDOR_GATE_STATUSES) expect(isVendorGateStatus(s)).toBe(true);
    expect(isVendorGateStatus("REQUESTED")).toBe(false);
    expect(isVendorGateStatus("")).toBe(false);
  });
});

describe("canDispatch", () => {
  it("REQUESTED + vendorId + (미발주 또는 거절후)면 발주 가능", () => {
    expect(canDispatch({ status: "REQUESTED", vendorId: "v1", vendorStatus: null })).toBe(true);
    expect(
      canDispatch({ status: "REQUESTED", vendorId: "v1", vendorStatus: "VENDOR_REJECTED" })
    ).toBe(true);
  });
  it("vendorId 없으면 불가", () => {
    expect(canDispatch({ status: "REQUESTED", vendorId: null, vendorStatus: null })).toBe(false);
  });
  it("이미 발송중·수락 상태면 재발주 불가(중복 방지)", () => {
    expect(
      canDispatch({ status: "REQUESTED", vendorId: "v1", vendorStatus: "PENDING_VENDOR" })
    ).toBe(false);
    expect(
      canDispatch({ status: "REQUESTED", vendorId: "v1", vendorStatus: "VENDOR_ACCEPTED" })
    ).toBe(false);
  });
  it("고객확정·취소 등 REQUESTED 아님이면 불가", () => {
    expect(canDispatch({ status: "CONFIRMED", vendorId: "v1", vendorStatus: null })).toBe(false);
    expect(canDispatch({ status: "CANCELLED", vendorId: "v1", vendorStatus: null })).toBe(false);
  });
});

describe("canConfirmCustomer", () => {
  it("vendorId 없음(직접제공)이면 항상 확정 가능", () => {
    expect(canConfirmCustomer({ vendorId: null, vendorStatus: null })).toBe(true);
    expect(canConfirmCustomer({ vendorId: null, vendorStatus: "VENDOR_REJECTED" })).toBe(true);
  });
  it("vendorId 있으면 VENDOR_ACCEPTED만 확정 가능", () => {
    expect(canConfirmCustomer({ vendorId: "v1", vendorStatus: "VENDOR_ACCEPTED" })).toBe(true);
    expect(canConfirmCustomer({ vendorId: "v1", vendorStatus: "PENDING_VENDOR" })).toBe(false);
    expect(canConfirmCustomer({ vendorId: "v1", vendorStatus: "VENDOR_REJECTED" })).toBe(false);
    expect(canConfirmCustomer({ vendorId: "v1", vendorStatus: null })).toBe(false);
  });
});

describe("assertVendorResponse", () => {
  it("PENDING_VENDOR면 통과", () => {
    expect(() => assertVendorResponse("PENDING_VENDOR")).not.toThrow();
  });
  it("그 외면 InvalidVendorResponseError", () => {
    expect(() => assertVendorResponse(null)).toThrow(InvalidVendorResponseError);
    expect(() => assertVendorResponse("VENDOR_ACCEPTED")).toThrow(InvalidVendorResponseError);
    expect(() => assertVendorResponse("VENDOR_REJECTED")).toThrow(InvalidVendorResponseError);
  });
  it("에러는 from을 보존", () => {
    try {
      assertVendorResponse("VENDOR_ACCEPTED");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidVendorResponseError);
      expect((e as InvalidVendorResponseError).from).toBe("VENDOR_ACCEPTED");
    }
  });
});
