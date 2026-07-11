// 벤더 발주 응답 — TICKET propose 서버 가드 테스트 (ticket-vendor-board)
//   - TICKET 주문에 action=propose → 400 TICKET_NO_PROPOSAL(시간 협의 무의미, UI·서버 대칭).
//   - accept/reject는 TICKET에서도 통과(기존 흐름 불변), 비TICKET propose도 통과(대조군).
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma mock ──
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

// 인증/인가
const requireAuth = vi.fn();
vi.mock("@/lib/api-guard", () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock("@/lib/permissions", () => ({ isVendor: (r?: string) => r === "VENDOR" }));

const getVendorIdForUser = vi.fn();
vi.mock("@/lib/vendor-auth", () => ({ getVendorIdForUser: (...a: unknown[]) => getVendorIdForUser(...a) }));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

const notifyOperators = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/vendor-dispatch", () => ({
  sendVendorResponseOperatorNotifications: (...a: unknown[]) => notifyOperators(...a),
}));

// 날짜 검증은 실존 Date 반환으로 통과시켜 TICKET 가드까지 도달시킨다.
vi.mock("@/lib/date-vn", () => ({
  parseUtcDateOnly: (s: string) => new Date(`${s}T00:00:00Z`),
}));
// vendor-order(assertVendorResponse·isTicketOnlyFromCounts)는 실제 로직 사용(미mock).

import { POST } from "@/app/api/vendor/orders/[id]/respond/route";

const call = (body: unknown) =>
  POST(
    new Request("http://local/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "so-1" }) }
  );

// findUnique가 돌려주는 발주 스냅샷(라우트 select 필드셋).
const orderBase = {
  id: "so-1",
  status: "REQUESTED",
  type: "TICKET",
  requestedVia: "ADMIN",
  bookingId: "bk-1",
  vendorId: "vd-1",
  vendorStatus: "PENDING_VENDOR",
  catalogItemId: "ci-1",
  vendorName: null,
  serviceDate: null,
  serviceTime: null,
  quantity: 1,
  costVnd: 0n,
  vendor: { name: "Ticket Co", nameKo: "티켓사" },
  booking: { villa: { name: "Villa A" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue({ ok: true, session: { user: { id: "vu-1", role: "VENDOR" } } });
  getVendorIdForUser.mockResolvedValue("vd-1");
  soUpdateMany.mockResolvedValue({ count: 1 });
  catalogFindUnique.mockResolvedValue({ nameKo: "입장권" });
});

describe("respond — TICKET propose 가드", () => {
  it("TICKET 주문 propose → 400 TICKET_NO_PROPOSAL, 상태 변경 없음", async () => {
    soFindUnique.mockResolvedValue({ ...orderBase, type: "TICKET" });
    const res = await call({ action: "propose", proposedServiceDate: "2026-08-01" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_NO_PROPOSAL" });
    expect(soUpdateMany).not.toHaveBeenCalled();
    expect(notifyOperators).not.toHaveBeenCalled();
  });

  it("TICKET 주문 accept → 200(기존 흐름 불변)", async () => {
    soFindUnique.mockResolvedValue({ ...orderBase, type: "TICKET" });
    const res = await call({ action: "accept" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ vendorStatus: "VENDOR_ACCEPTED", action: "accept" });
    expect(soUpdateMany).toHaveBeenCalledOnce();
  });

  it("TICKET 주문 reject → 200(기존 흐름 불변)", async () => {
    soFindUnique.mockResolvedValue({ ...orderBase, type: "TICKET" });
    const res = await call({ action: "reject", rejectReason: "품절" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ vendorStatus: "VENDOR_REJECTED", action: "reject" });
    expect(soUpdateMany).toHaveBeenCalledOnce();
  });

  it("비TICKET 주문 propose → 200(대조군: 시간 협의 정상 동작)", async () => {
    soFindUnique.mockResolvedValue({ ...orderBase, type: "MASSAGE" });
    const res = await call({
      action: "propose",
      proposedServiceDate: "2026-08-01",
      proposedServiceTime: "14:00",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ vendorStatus: "VENDOR_ACCEPTED", action: "propose" });
    expect(soUpdateMany).toHaveBeenCalledOnce();
  });
});
