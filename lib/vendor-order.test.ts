// lib/vendor-order 순수 로직 테스트 (ADR-0023 S2)
import { describe, it, expect } from "vitest";
import {
  VENDOR_GATE_TRANSITIONS,
  VENDOR_GATE_STATUSES,
  canReportComplete,
  canTransitionVendorGate,
  canDispatch,
  canConfirmCustomer,
  hasUnresolvedProposal,
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
  it("미해결 제안(대안 시간)이 걸려 있으면 수락 상태라도 확정 차단", () => {
    // 공급자가 수락하되 대안 시간 제안 → 운영자 미처리(vendorProposalRespondedAt=null) → 차단
    expect(
      canConfirmCustomer({
        vendorId: "v1",
        vendorStatus: "VENDOR_ACCEPTED",
        proposedServiceDate: new Date("2026-07-01T00:00:00.000Z"),
        vendorProposalRespondedAt: null,
      })
    ).toBe(false);
  });
  it("제안이 운영자에 의해 해결되면(적용/무시) 다시 확정 가능", () => {
    expect(
      canConfirmCustomer({
        vendorId: "v1",
        vendorStatus: "VENDOR_ACCEPTED",
        proposedServiceDate: new Date("2026-07-01T00:00:00.000Z"),
        vendorProposalRespondedAt: new Date("2026-06-28T09:00:00.000Z"),
      })
    ).toBe(true);
  });
  it("레거시 호출부(제안 필드 미제공)는 기존 동작 보존", () => {
    expect(canConfirmCustomer({ vendorId: "v1", vendorStatus: "VENDOR_ACCEPTED" })).toBe(true);
  });
});

describe("hasUnresolvedProposal", () => {
  it("제안 있고 미응답이면 true", () => {
    expect(
      hasUnresolvedProposal({
        proposedServiceDate: new Date("2026-07-01T00:00:00.000Z"),
        vendorProposalRespondedAt: null,
      })
    ).toBe(true);
  });
  it("제안 없으면 false", () => {
    expect(hasUnresolvedProposal({ proposedServiceDate: null, vendorProposalRespondedAt: null })).toBe(
      false
    );
    expect(hasUnresolvedProposal({})).toBe(false);
  });
  it("제안 있어도 응답 시각이 채워졌으면 false(해결됨)", () => {
    expect(
      hasUnresolvedProposal({
        proposedServiceDate: new Date("2026-07-01T00:00:00.000Z"),
        vendorProposalRespondedAt: new Date("2026-06-28T09:00:00.000Z"),
      })
    ).toBe(false);
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

describe("canReportComplete — 서비스 이행 완료 보고 가능", () => {
  const base = { vendorStatus: "VENDOR_ACCEPTED" as const, status: "CONFIRMED", vendorCompletedAt: null };
  it("수락+미취소+미보고 → true", () => {
    expect(canReportComplete(base)).toBe(true);
    expect(canReportComplete({ ...base, status: "REQUESTED" })).toBe(true);
  });
  it("취소된 주문 → false", () => {
    expect(canReportComplete({ ...base, status: "CANCELLED" })).toBe(false);
  });
  it("미수락(대기·거절·미발주) → false", () => {
    expect(canReportComplete({ ...base, vendorStatus: "PENDING_VENDOR" })).toBe(false);
    expect(canReportComplete({ ...base, vendorStatus: "VENDOR_REJECTED" })).toBe(false);
    expect(canReportComplete({ ...base, vendorStatus: null })).toBe(false);
  });
  it("이미 보고됨 → false(멱등)", () => {
    expect(
      canReportComplete({ ...base, vendorCompletedAt: new Date("2026-07-03T05:00:00.000Z") })
    ).toBe(false);
  });
});
