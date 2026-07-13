// 무료 티켓 취소 시 벤더 "발주 취소" Zalo 오발송 차단 (P3-①)
//   service-orders PATCH status→CANCELLED에서 무료 티켓(type=TICKET·priceVnd=0·costVnd=0)은
//   실제 PO 발송 이력이 없으므로 취소 통보(sendVendorPoCancelledNotifications)를 내지 않는다.
//   유료 티켓·일반 주문(살아있는 PO)의 취소 통보는 불변.
import { describe, it, expect, vi, beforeEach } from "vitest";

const soFindUnique = vi.fn();
const soUpdateMany = vi.fn();
const catalogFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceOrder: {
      findUnique: (...a: unknown[]) => soFindUnique(...a),
      updateMany: (...a: unknown[]) => soUpdateMany(...a),
    },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

const requireCapability = vi.fn();
vi.mock("@/lib/api-guard", () => ({ requireCapability: (...a: unknown[]) => requireCapability(...a) }));

vi.mock("@/lib/permissions", () => ({
  isOperator: (r?: string) => r === "ADMIN",
  canViewFinance: (r?: string) => r === "ADMIN",
}));

const sendVendorPoCancelledNotifications = vi.fn((..._a: unknown[]) => Promise.resolve({ zaloSent: true }));
vi.mock("@/lib/vendor-dispatch", () => ({
  sendVendorPoCancelledNotifications: (...a: unknown[]) => sendVendorPoCancelledNotifications(...a),
}));

vi.mock("@/lib/inapp-notification", () => ({
  enqueueInAppNotification: vi.fn(async () => {}),
  buildVendorNotifText: () => ({ title: "t", body: "b" }),
  vendorNotifLocale: () => "vi",
}));

import { PATCH } from "@/app/api/service-orders/[id]/route";

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const P = (id: string) => ({ params: Promise.resolve({ id }) });

// 살아있는 PO(VENDOR_ACCEPTED)로 준비 중인 주문 — 취소 통보 판정의 기준.
const liveOrder = {
  id: "so-1",
  status: "CONFIRMED",
  vendorId: "v-1",
  vendorStatus: "VENDOR_ACCEPTED",
  type: "TICKET",
  priceVnd: 0n,
  costVnd: 0n,
  proposedServiceDate: null,
  vendorProposalRespondedAt: null,
  booking: { status: "CONFIRMED" },
};

// 두 번째 findUnique(info) 페이로드 — 통보 문구 조립용.
const info = {
  quantity: 1,
  serviceDate: null,
  catalogItemId: "ci-1",
  vendorName: "Cable Co",
  costVnd: 0n,
  vendor: { userId: "vu-1", user: { zaloUserId: "z-1", locale: "vi" } },
  booking: { villa: { name: "Villa A" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  requireCapability.mockResolvedValue({ ok: true, session: { user: { id: "op-1", role: "ADMIN" } } });
  soUpdateMany.mockResolvedValue({ count: 1 });
  catalogFindUnique.mockResolvedValue({ nameKo: "케이블카" });
});

describe("무료 티켓 취소 통보 제외 (P3-①)", () => {
  it("무료 티켓(priceVnd=0·costVnd=0) 취소 → 취소 통보 미발송(PO 이력 없음)", async () => {
    soFindUnique.mockResolvedValueOnce({ ...liveOrder }); // existing (free ticket)
    const res = await PATCH(jsonReq({ status: "CANCELLED" }), P("so-1"));
    expect(res.status).toBe(200);
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
  });

  it("유료 티켓(costVnd>0) 취소 → 취소 통보 발송(불변)", async () => {
    soFindUnique
      .mockResolvedValueOnce({ ...liveOrder, priceVnd: 800000n, costVnd: 500000n }) // existing
      .mockResolvedValueOnce({ ...info, costVnd: 500000n }); // info
    const res = await PATCH(jsonReq({ status: "CANCELLED" }), P("so-1"));
    expect(res.status).toBe(200);
    expect(sendVendorPoCancelledNotifications).toHaveBeenCalledOnce();
  });

  it("일반(비TICKET) 주문 취소 → 취소 통보 발송(불변)", async () => {
    soFindUnique
      .mockResolvedValueOnce({ ...liveOrder, type: "MASSAGE", priceVnd: 0n, costVnd: 0n }) // existing
      .mockResolvedValueOnce({ ...info }); // info
    const res = await PATCH(jsonReq({ status: "CANCELLED" }), P("so-1"));
    expect(res.status).toBe(200);
    // 비TICKET은 무료 판정에 안 걸림(type≠TICKET) → 살아있는 PO 취소이므로 통보 발송.
    expect(sendVendorPoCancelledNotifications).toHaveBeenCalledOnce();
  });

  it("무료 티켓이라도 미발주(vendorStatus=null)면 원래부터 통보 없음(회귀 확인)", async () => {
    soFindUnique.mockResolvedValueOnce({ ...liveOrder, vendorStatus: null, vendorId: null });
    const res = await PATCH(jsonReq({ status: "CANCELLED" }), P("so-1"));
    expect(res.status).toBe(200);
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
  });
});
