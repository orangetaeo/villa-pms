// 벤더 발주 목록 GET — freeEntry 파생(무료 티켓) + 판매가 값 누수 방어 (ADR-0034 §3-2)
//   - TICKET·priceVnd=0 → freeEntry=true / priceVnd>0 → false / 비TICKET → false
//   - ★누수: 응답에 priceVnd 값 자체 미포함(boolean freeEntry만). 화이트리스트 불변.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma mock ──
const soCount = vi.fn();
const soFindMany = vi.fn();
const soAggregate = vi.fn();
const catalogFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceOrder: {
      count: (...a: unknown[]) => soCount(...a),
      findMany: (...a: unknown[]) => soFindMany(...a),
      aggregate: (...a: unknown[]) => soAggregate(...a),
    },
    serviceCatalogItem: { findMany: (...a: unknown[]) => catalogFindMany(...a) },
  },
}));

const authFn = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => authFn(...a) }));
vi.mock("@/lib/permissions", () => ({ isVendor: (r?: string) => r === "VENDOR" }));

const getVendorIdForUser = vi.fn();
vi.mock("@/lib/vendor-auth", () => ({ getVendorIdForUser: (...a: unknown[]) => getVendorIdForUser(...a) }));

vi.mock("@/lib/locale", () => ({ getSupplierLocale: vi.fn(async () => "vi") }));
vi.mock("@/lib/service-display", () => ({
  pickI18n: () => "item",
  selectedOptionLabels: () => [],
}));
vi.mock("@/lib/villa-name", () => ({ formatVillaName: () => "villa" }));

import { GET } from "@/app/api/vendor/orders/route";

const call = (qs: string) => GET(new Request(`http://local/api/vendor/orders?${qs}`));

// mapRows가 접근하는 최소 필드셋(null 기본). costVnd·priceVnd는 bigint.
const rowBase = {
  id: "so-1",
  type: "TICKET",
  status: "CONFIRMED",
  vendorStatus: "VENDOR_ACCEPTED",
  serviceDate: null,
  serviceTime: null,
  quantity: 1,
  costVnd: 0n,
  priceVnd: 0n,
  vendorSettledAt: null,
  vendorSettleMethod: null,
  vendorSettleNote: null,
  poSentAt: null,
  vendorRespondedAt: null,
  vendorCompletedAt: null,
  proposedServiceDate: null,
  proposedServiceTime: null,
  vendorProposalNote: null,
  vendorProposalRespondedAt: null,
  vendorProposalOutcome: null,
  createdAt: null,
  catalogItemId: null,
  vendorName: null,
  guestNote: null,
  customerName: null as string | null,
  selectedOptions: null,
  ticketUrls: [],
  ticketGuests: null,
  booking: { checkIn: null, checkOut: null, guestCount: 2, guestName: "대표자", villa: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  authFn.mockResolvedValue({ user: { id: "vu-1", role: "VENDOR", locale: "vi" } });
  getVendorIdForUser.mockResolvedValue("vd-1");
  soCount.mockResolvedValue(0);
  soFindMany.mockResolvedValue([]);
  soAggregate.mockResolvedValue({ _sum: { costVnd: null }, _count: 0 });
  catalogFindMany.mockResolvedValue([]);
});

describe("vendor orders — freeEntry 파생 + 판매가 누수 방어", () => {
  it("TICKET·priceVnd=0 → freeEntry=true, priceVnd>0 → false, 비TICKET → false", async () => {
    soFindMany.mockResolvedValueOnce([
      { ...rowBase, id: "free", type: "TICKET", priceVnd: 0n }, // 무료 입장
      { ...rowBase, id: "paid", type: "TICKET", priceVnd: 500000n }, // 유료 티켓
      { ...rowBase, id: "massage", type: "MASSAGE", priceVnd: 0n }, // 비TICKET은 항상 false
    ]);
    const res = await call("tab=schedule");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    const byId = new Map(json.orders.map((o) => [o.id, o]));
    expect(byId.get("free")!.freeEntry).toBe(true);
    expect(byId.get("paid")!.freeEntry).toBe(false);
    expect(byId.get("massage")!.freeEntry).toBe(false);
  });

  it("★누수: 응답 행에 priceVnd 값 자체가 없어야 함(freeEntry boolean만)", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "free", type: "TICKET", priceVnd: 0n }]);
    const res = await call("tab=schedule");
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    expect(json.orders[0]).not.toHaveProperty("priceVnd");
    expect(json.orders[0]).not.toHaveProperty("priceKrw");
    expect(json.orders[0]).not.toHaveProperty("marginValue");
    // freeEntry는 boolean 타입
    expect(typeof json.orders[0].freeEntry).toBe("boolean");
  });
});
