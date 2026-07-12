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
  groupAdminOrders,
  isFreeTicket,
  type OrderAttentionInput,
  type OrderGroupInput,
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
    priceVnd: null,
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
    // ★무료 티켓(판매가 0)은 발행 불필요 — ticketShort 제외
    expect(
      orderAttention(att({ type: "TICKET", quantity: 2, ticketUrls: [], priceVnd: "0" })).ticketShort
    ).toBe(false);
    // 유료 티켓(판매가>0)은 여전히 미달 신호
    expect(
      orderAttention(att({ type: "TICKET", quantity: 2, ticketUrls: [], priceVnd: "300000" }))
        .ticketShort
    ).toBe(true);
  });
  it("orderHasAttention = 세 신호 OR", () => {
    expect(orderHasAttention(att())).toBe(false);
    expect(orderHasAttention(att({ status: "REQUESTED" }))).toBe(true);
    expect(orderHasAttention(att({ type: "TICKET", quantity: 1, ticketUrls: [] }))).toBe(true);
  });
});

describe("무료 입장 티켓 판정(isFreeTicket)", () => {
  it("TICKET·판매가 '0'만 무료", () => {
    expect(isFreeTicket({ type: "TICKET", priceVnd: "0" })).toBe(true);
    expect(isFreeTicket({ type: "TICKET", priceVnd: "300000" })).toBe(false);
    // priceVnd null(가격 미설정·레거시)은 무료 아님(명시 0만)
    expect(isFreeTicket({ type: "TICKET", priceVnd: null })).toBe(false);
    // 비TICKET은 판매가 0이어도 무료 티켓 아님
    expect(isFreeTicket({ type: "FOOD", priceVnd: "0" })).toBe(false);
    expect(isFreeTicket({ type: "MASSAGE", priceVnd: null })).toBe(false);
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

// 그룹핑 최소 주문 팩토리 — 그룹핑에 쓰는 필드만 의미 있고 나머지는 무해한 기본값.
function ord(p: Partial<OrderGroupInput> & { catalogItemId: string | null }): OrderGroupInput {
  return {
    status: p.status ?? "CONFIRMED",
    type: p.type ?? "TICKET",
    quantity: p.quantity ?? 1,
    ticketUrls: p.ticketUrls ?? [],
    vendorStatus: p.vendorStatus ?? null,
    proposedServiceDate: p.proposedServiceDate ?? null,
    vendorProposalRespondedAt: p.vendorProposalRespondedAt ?? null,
    catalogItemId: p.catalogItemId,
    serviceDate: p.serviceDate ?? null,
    nameKo: p.nameKo ?? "품목",
    priceKrw: p.priceKrw ?? 0,
    priceVnd: p.priceVnd ?? null,
  };
}

describe("groupAdminOrders — 품목+이용일 그룹핑", () => {
  it("같은 품목·이용일의 구분 분리 주문을 한 그룹으로 묶고 수량·판매가 합산(무료 라인은 티켓 카운터 제외)", () => {
    // 키스브릿지 1건 = 무료 1 + 일반 2 (구분별 분리 저장)
    const groups = groupAdminOrders([
      ord({ catalogItemId: "ci-1", nameKo: "키스브릿지", quantity: 1, priceVnd: "0", priceKrw: 0, serviceDate: "2026-08-01" }),
      ord({ catalogItemId: "ci-1", nameKo: "키스브릿지", quantity: 2, priceVnd: "300000", priceKrw: 30000, serviceDate: "2026-08-01" }),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.name).toBe("키스브릿지");
    expect(g.serviceDate).toBe("2026-08-01");
    expect(g.orders).toHaveLength(2);
    expect(g.totalQuantity).toBe(3); // 총수량은 무료 포함(구매 전체)
    expect(g.totalPriceVnd).toBe("300000");
    expect(g.totalPriceKrw).toBe(30000);
    expect(g.hasTicket).toBe(true); // 유료 티켓 라인 존재
    expect(g.ticketIssued).toBe(0); // 아직 발행 없음
    expect(g.ticketNeeded).toBe(2); // ★무료 1 제외 → 유료 2만 발행 대상(테오: 2/3장→2/2장)
    expect(g.attention.ticketShort).toBe(true); // 유료 2장 미발행
  });

  it("무료 티켓만 있는 그룹 — 티켓 카운터·발행 신호 전부 없음(hasTicket=false)", () => {
    const g = groupAdminOrders([
      ord({ catalogItemId: "ci-free", type: "TICKET", quantity: 2, priceVnd: "0", ticketUrls: [], serviceDate: "d" }),
    ])[0];
    expect(g.hasTicket).toBe(false);
    expect(g.ticketIssued).toBe(0);
    expect(g.ticketNeeded).toBe(0);
    expect(g.attention.ticketShort).toBe(false);
    expect(g.hasAttention).toBe(false);
  });

  it("catalogItemId null이면 type으로 폴백해 그룹핑", () => {
    const groups = groupAdminOrders([
      ord({ catalogItemId: null, type: "BBQ", serviceDate: "2026-08-02" }),
      ord({ catalogItemId: null, type: "BBQ", serviceDate: "2026-08-02" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalQuantity).toBe(2);
  });

  it("같은 품목이라도 이용일이 다르면 별도 그룹(키에 이용일 포함)", () => {
    const groups = groupAdminOrders([
      ord({ catalogItemId: "ci-1", serviceDate: "2026-08-01" }),
      ord({ catalogItemId: "ci-1", serviceDate: "2026-08-03" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("입력 순서(첫 등장) 보존", () => {
    const groups = groupAdminOrders([
      ord({ catalogItemId: "ci-b", serviceDate: "2026-08-05" }),
      ord({ catalogItemId: "ci-a", serviceDate: "2026-08-01" }),
      ord({ catalogItemId: "ci-b", serviceDate: "2026-08-05" }),
    ]);
    expect(groups.map((g) => g.orders[0].catalogItemId)).toEqual(["ci-b", "ci-a"]);
    expect(groups[0].orders).toHaveLength(2);
  });

  it("대표 상태 우선순위 요청>확정>제공완료>취소", () => {
    const g1 = groupAdminOrders([
      ord({ catalogItemId: "ci-1", status: "CANCELLED", serviceDate: "d" }),
      ord({ catalogItemId: "ci-1", status: "CONFIRMED", serviceDate: "d" }),
      ord({ catalogItemId: "ci-1", status: "REQUESTED", serviceDate: "d" }),
    ])[0];
    expect(g1.representativeStatus).toBe("REQUESTED");
    const g2 = groupAdminOrders([
      ord({ catalogItemId: "ci-2", status: "CANCELLED", serviceDate: "d" }),
      ord({ catalogItemId: "ci-2", status: "DELIVERED", serviceDate: "d" }),
    ])[0];
    // 확정(CONFIRMED) 없으면 DELIVERED가 취소보다 우선
    expect(g2.representativeStatus).toBe("DELIVERED");
    const g3 = groupAdminOrders([
      ord({ catalogItemId: "ci-3", status: "DELIVERED", serviceDate: "d" }),
      ord({ catalogItemId: "ci-3", status: "CONFIRMED", serviceDate: "d" }),
    ])[0];
    expect(g3.representativeStatus).toBe("CONFIRMED");
  });

  it("그룹 attention = 라인 orderAttention OR 승격", () => {
    const g = groupAdminOrders([
      ord({ catalogItemId: "ci-1", status: "CONFIRMED", serviceDate: "d" }), // 신호 없음
      ord({
        catalogItemId: "ci-1",
        status: "REQUESTED", // requested 신호
        vendorStatus: "VENDOR_ACCEPTED",
        proposedServiceDate: "2026-08-10", // 미해결 제안 신호
        serviceDate: "d",
      }),
    ])[0];
    expect(g.attention.requested).toBe(true);
    expect(g.attention.unresolvedProposal).toBe(true);
    expect(g.hasAttention).toBe(true);
  });

  it("티켓 카운터 합 — TICKET 라인만 집계(비티켓 제외)", () => {
    const g = groupAdminOrders([
      ord({ catalogItemId: "ci-1", type: "TICKET", quantity: 2, ticketUrls: ["a", "b"], serviceDate: "d" }),
      ord({ catalogItemId: "ci-1", type: "TICKET", quantity: 3, ticketUrls: ["c"], serviceDate: "d" }),
    ])[0];
    expect(g.ticketIssued).toBe(3);
    expect(g.ticketNeeded).toBe(5);
    expect(g.attention.ticketShort).toBe(true);
  });

  it("1주문 그룹 — 단일 라인, 집계는 그 주문 그대로", () => {
    const groups = groupAdminOrders([
      ord({ catalogItemId: "ci-solo", quantity: 4, priceVnd: "120000", serviceDate: "2026-08-01" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].orders).toHaveLength(1);
    expect(groups[0].totalQuantity).toBe(4);
    expect(groups[0].totalPriceVnd).toBe("120000");
  });

  it("빈 입력 → 빈 배열", () => {
    expect(groupAdminOrders([])).toEqual([]);
  });
});
