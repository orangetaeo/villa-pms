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
  orderAttention,
  orderHasAttention,
  orderBucket,
  orderFilterCounts,
  type OrderAttentionInput,
} from "./service-order";

// 접힘 행 신호 테스트용 기본 주문(신호 없음) — 필드별로 오버라이드해 판정 검증.
function att(over: Partial<OrderAttentionInput> = {}): OrderAttentionInput {
  return {
    status: "CONFIRMED",
    type: "FOOD",
    quantity: 2,
    ticketUrls: [],
    vendorStatus: null,
    proposedServiceDate: null,
    vendorProposalRespondedAt: null,
    ...over,
  };
}

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

describe("접힘 행 처리 필요 신호(orderAttention)", () => {
  it("REQUESTED = requested 신호", () => {
    expect(orderAttention(att({ status: "REQUESTED" })).requested).toBe(true);
    expect(orderAttention(att({ status: "CONFIRMED" })).requested).toBe(false);
  });
  it("미해결 시간제안 = 수락+제안일+미응답일 때만", () => {
    const base = { vendorStatus: "VENDOR_ACCEPTED" as const, proposedServiceDate: "2026-07-20" };
    expect(orderAttention(att(base)).unresolvedProposal).toBe(true);
    // 이미 처리(응답 시각 있음)
    expect(
      orderAttention(att({ ...base, vendorProposalRespondedAt: "2026-07-13T00:00:00Z" }))
        .unresolvedProposal
    ).toBe(false);
    // 제안 없음
    expect(orderAttention(att({ vendorStatus: "VENDOR_ACCEPTED" })).unresolvedProposal).toBe(false);
    // 미수락(발주대기)이면 제안 신호 아님
    expect(
      orderAttention(att({ vendorStatus: "PENDING_VENDOR", proposedServiceDate: "2026-07-20" }))
        .unresolvedProposal
    ).toBe(false);
  });
  it("티켓 발행 미달 = TICKET+발행<수량+미종결", () => {
    expect(orderAttention(att({ type: "TICKET", quantity: 2, ticketUrls: ["a"] })).ticketShort).toBe(
      true
    );
    // 충족
    expect(
      orderAttention(att({ type: "TICKET", quantity: 2, ticketUrls: ["a", "b"] })).ticketShort
    ).toBe(false);
    // 취소는 신호 없음
    expect(
      orderAttention(att({ type: "TICKET", quantity: 2, ticketUrls: [], status: "CANCELLED" }))
        .ticketShort
    ).toBe(false);
    // 비티켓은 무관
    expect(orderAttention(att({ type: "FOOD", quantity: 5, ticketUrls: [] })).ticketShort).toBe(
      false
    );
  });
  it("orderHasAttention = 세 신호 OR", () => {
    expect(orderHasAttention(att())).toBe(false);
    expect(orderHasAttention(att({ status: "REQUESTED" }))).toBe(true);
    expect(orderHasAttention(att({ type: "TICKET", quantity: 1, ticketUrls: [] }))).toBe(true);
  });
});

describe("상태 필터 버킷·건수", () => {
  it("orderBucket — DELIVERED는 confirmed에 포함", () => {
    expect(orderBucket("REQUESTED")).toBe("requested");
    expect(orderBucket("CONFIRMED")).toBe("confirmed");
    expect(orderBucket("DELIVERED")).toBe("confirmed");
    expect(orderBucket("CANCELLED")).toBe("cancelled");
  });
  it("orderFilterCounts — all=총합, 버킷별 합산", () => {
    const counts = orderFilterCounts([
      { status: "REQUESTED" },
      { status: "REQUESTED" },
      { status: "CONFIRMED" },
      { status: "DELIVERED" },
      { status: "CANCELLED" },
    ]);
    expect(counts).toEqual({ all: 5, requested: 2, confirmed: 2, cancelled: 1 });
  });
});
