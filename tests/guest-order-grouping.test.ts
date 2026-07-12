// tests/guest-order-grouping.test.ts — 게스트 신청 내역 품목별 그룹핑 순수 함수 (테오: 구분별 흩어짐 해소)
//   groupGuestOrders: catalogItemId(없으면 type) 기준 묶음, 총 수량 합, 이용일 동일 시 헤더 표기,
//   그룹 정렬(이용일 오름차순 → 최신 생성).
import { describe, it, expect } from "vitest";
import { groupGuestOrders } from "@/app/g/_components/group-orders";
import type { GuestRequestedOrder } from "@/app/g/_components/types";

// 최소 주문 팩토리 — 그룹핑에 쓰는 필드만 의미 있고 나머지는 무해한 기본값.
function order(p: Partial<GuestRequestedOrder> & { id: string }): GuestRequestedOrder {
  return {
    id: p.id,
    type: p.type ?? "TICKET",
    catalogItemId: p.catalogItemId ?? null,
    name: p.name ?? "품목",
    status: p.status ?? "REQUESTED",
    quantity: p.quantity ?? 1,
    priceKrw: p.priceKrw ?? null,
    priceVnd: p.priceVnd ?? null,
    dispatched: p.dispatched ?? false,
    vendorAccepted: p.vendorAccepted ?? false,
    vendorName: p.vendorName ?? null,
    vendorPhone: p.vendorPhone ?? null,
    optionLabels: p.optionLabels ?? [],
    serviceDate: p.serviceDate ?? null,
    serviceTime: p.serviceTime ?? null,
    proposedServiceDate: p.proposedServiceDate ?? null,
    proposedServiceTime: p.proposedServiceTime ?? null,
    vendorProposalNote: p.vendorProposalNote ?? null,
    proposalPending: p.proposalPending ?? false,
    fulfillNote: p.fulfillNote ?? "",
    ticketUrls: p.ticketUrls ?? [],
  };
}

describe("groupGuestOrders — 품목별 묶음", () => {
  it("같은 catalogItemId의 구분별 주문이 한 그룹으로 묶이고 수량이 합산된다", () => {
    const orders = [
      order({ id: "a", catalogItemId: "ci-1", name: "사파리 입장권", optionLabels: ["성인"], quantity: 2, serviceDate: "2026-08-01" }),
      order({ id: "b", catalogItemId: "ci-1", name: "사파리 입장권", optionLabels: ["어린이"], quantity: 3, serviceDate: "2026-08-01" }),
    ];
    const groups = groupGuestOrders(orders);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("ci-1");
    expect(groups[0].name).toBe("사파리 입장권");
    expect(groups[0].totalQuantity).toBe(5);
    expect(groups[0].orders.map((o) => o.id)).toEqual(["a", "b"]);
    // 이용일이 동일 → 헤더 표기
    expect(groups[0].serviceDate).toBe("2026-08-01");
  });

  it("catalogItemId가 다르면 별도 그룹", () => {
    const orders = [
      order({ id: "a", catalogItemId: "ci-1", serviceDate: "2026-08-01" }),
      order({ id: "b", catalogItemId: "ci-2", serviceDate: "2026-08-01" }),
    ];
    expect(groupGuestOrders(orders)).toHaveLength(2);
  });

  it("catalogItemId null이면 type으로 폴백 그룹핑", () => {
    const orders = [
      order({ id: "a", catalogItemId: null, type: "BBQ", serviceDate: "2026-08-02" }),
      order({ id: "b", catalogItemId: null, type: "BBQ", serviceDate: "2026-08-02" }),
      order({ id: "c", catalogItemId: null, type: "MASSAGE", serviceDate: "2026-08-02" }),
    ];
    const groups = groupGuestOrders(orders);
    expect(groups).toHaveLength(2);
    const bbq = groups.find((g) => g.key === "BBQ");
    expect(bbq?.orders.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("그룹 내 이용일이 다르면 헤더 날짜는 null(줄마다 개별 표기)", () => {
    const orders = [
      order({ id: "a", catalogItemId: "ci-1", serviceDate: "2026-08-01" }),
      order({ id: "b", catalogItemId: "ci-1", serviceDate: "2026-08-03" }),
    ];
    expect(groupGuestOrders(orders)[0].serviceDate).toBeNull();
  });
});

describe("groupGuestOrders — 정렬", () => {
  it("그룹은 이용일 오름차순으로 정렬(최소 이용일 기준)", () => {
    const orders = [
      order({ id: "later", catalogItemId: "ci-late", serviceDate: "2026-08-10" }),
      order({ id: "early", catalogItemId: "ci-early", serviceDate: "2026-08-02" }),
    ];
    expect(groupGuestOrders(orders).map((g) => g.key)).toEqual(["ci-early", "ci-late"]);
  });

  it("이용일 없는 그룹은 날짜 있는 그룹보다 뒤로", () => {
    const orders = [
      order({ id: "nodate", catalogItemId: "ci-x", serviceDate: null }),
      order({ id: "dated", catalogItemId: "ci-y", serviceDate: "2026-08-05" }),
    ];
    expect(groupGuestOrders(orders).map((g) => g.key)).toEqual(["ci-y", "ci-x"]);
  });

  it("이용일 동률이면 최신 생성 우선(입력 createdAt desc 순서 유지)", () => {
    // 입력은 로더가 createdAt desc로 넘김 → 먼저 등장한 그룹이 더 최신.
    const orders = [
      order({ id: "newest", catalogItemId: "ci-a", serviceDate: "2026-08-01" }),
      order({ id: "older", catalogItemId: "ci-b", serviceDate: "2026-08-01" }),
    ];
    expect(groupGuestOrders(orders).map((g) => g.key)).toEqual(["ci-a", "ci-b"]);
  });
});
