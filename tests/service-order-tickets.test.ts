// 티켓형(TICKET) QR 티켓 발행/삭제 API 테스트 (ADR-0034)
//   - 벤더 업로드: 성공 + 발행=수락 겸행 전이(GUEST→CONFIRMED)·타벤더 404·비TICKET 400·상한 400·CANCELLED 409·동시성 409
//   - 벤더 삭제: 성공·미존재 404
//   - 운영자 대리 업로드: 상태 불변(전이 없음)
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

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

// 인증/인가 — 벤더는 requireAuth, 운영자는 requireCapability.
const requireAuth = vi.fn();
const requireCapability = vi.fn();
vi.mock("@/lib/api-guard", () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));

vi.mock("@/lib/permissions", () => ({
  isVendor: (r?: string) => r === "VENDOR",
  isOperator: (r?: string) => r === "ADMIN" || r === "OWNER" || r === "MANAGER" || r === "STAFF",
}));

const getVendorIdForUser = vi.fn();
vi.mock("@/lib/vendor-auth", () => ({
  getVendorIdForUser: (...a: unknown[]) => getVendorIdForUser(...a),
}));

const saveTicketFiles = vi.fn();
vi.mock("@/lib/ticket-upload", () => ({
  saveTicketFiles: (...a: unknown[]) => saveTicketFiles(...a),
  MAX_TICKETS_PER_ORDER: 30,
}));

const sendVendorResponseOperatorNotifications = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/vendor-dispatch", () => ({
  sendVendorResponseOperatorNotifications: (...a: unknown[]) =>
    sendVendorResponseOperatorNotifications(...a),
}));

import { POST as VENDOR_POST, DELETE as VENDOR_DELETE } from "@/app/api/vendor/orders/[id]/tickets/route";
import { POST as ADMIN_POST } from "@/app/api/service-orders/[id]/tickets/route";

const formReq = () => new Request("http://local/x", { method: "POST", body: new FormData() });
const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const P = (id: string) => ({ params: Promise.resolve({ id }) });

const vendorSession = {
  ok: true as const,
  session: { user: { id: "vu-1", role: "VENDOR" } },
  userId: "vu-1",
  role: "VENDOR",
};
const operatorGuard = {
  ok: true as const,
  session: { user: { id: "op-1", role: "ADMIN" } },
  userId: "op-1",
  role: "ADMIN",
};

const baseTicketOrder = {
  id: "so-1",
  type: "TICKET",
  status: "REQUESTED",
  requestedVia: "GUEST",
  bookingId: "bk-1",
  vendorId: "v-1",
  vendorStatus: "PENDING_VENDOR",
  ticketUrls: [] as string[],
  ticketsIssuedAt: null,
  catalogItemId: "ci-1",
  vendorName: "Cable Co",
  serviceDate: null,
  serviceTime: null,
  quantity: 2,
  costVnd: 0n,
  vendor: { name: "Cable Co", nameKo: "케이블카" },
  booking: { villa: { name: "Villa A" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue(vendorSession);
  requireCapability.mockResolvedValue(operatorGuard);
  getVendorIdForUser.mockResolvedValue("v-1");
  saveTicketFiles.mockResolvedValue({ ok: true, urls: ["/u/a.jpg", "/u/b.jpg"] });
  catalogFindUnique.mockResolvedValue({ nameKo: "케이블카" });
  soUpdateMany.mockResolvedValue({ count: 1 });
});

describe("벤더 티켓 발행 POST", () => {
  it("PENDING_VENDOR·GUEST 주문에 발행 → VENDOR_ACCEPTED + CONFIRMED 전이 + 운영자 통보", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticketUrls).toEqual(["/u/a.jpg", "/u/b.jpg"]);
    expect(body.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(body.status).toBe("CONFIRMED");
    // 원자 가드: where에 PENDING_VENDOR + status REQUESTED, data에 전이 필드
    const call = soUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(call.where.vendorStatus).toBe("PENDING_VENDOR");
    expect(call.where.status).toBe("REQUESTED");
    expect(call.data.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(call.data.status).toBe("CONFIRMED");
    expect(call.data.ticketsIssuedAt).toBeInstanceOf(Date);
    expect(sendVendorResponseOperatorNotifications).toHaveBeenCalledOnce();
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it("이미 VENDOR_ACCEPTED면 추가 발행만 — 전이·통보 없음", async () => {
    soFindUnique.mockResolvedValue({
      ...baseTicketOrder,
      status: "CONFIRMED",
      vendorStatus: "VENDOR_ACCEPTED",
      ticketUrls: ["/u/existing.jpg"],
      ticketsIssuedAt: new Date(),
    });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(body.status).toBe("CONFIRMED");
    expect(body.ticketUrls).toHaveLength(3); // 기존 1 + 신규 2
    const call = soUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(call.where.vendorStatus).toBeUndefined();
    expect(call.data.vendorStatus).toBeUndefined();
    expect(call.data.ticketsIssuedAt).toBeUndefined(); // 최초 발행 시각 유지
    expect(sendVendorResponseOperatorNotifications).not.toHaveBeenCalled();
  });

  it("타 벤더 주문이면 404(존재 은닉) — 저장 안 함", async () => {
    getVendorIdForUser.mockResolvedValue("v-2");
    soFindUnique.mockResolvedValue({ ...baseTicketOrder });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(404);
    expect(saveTicketFiles).not.toHaveBeenCalled();
    expect(soUpdateMany).not.toHaveBeenCalled();
  });

  it("비TICKET 주문이면 400 NOT_TICKET_ORDER", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder, type: "MASSAGE" });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "NOT_TICKET_ORDER" });
  });

  it("상한 초과면 400 TOO_MANY_TICKETS", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder });
    saveTicketFiles.mockResolvedValue({ ok: false, error: "TOO_MANY_TICKETS" });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TOO_MANY_TICKETS" });
    expect(soUpdateMany).not.toHaveBeenCalled();
  });

  it("CANCELLED 주문이면 409 — 저장 안 함", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder, status: "CANCELLED" });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(409);
    expect(saveTicketFiles).not.toHaveBeenCalled();
  });

  it("동시성 충돌(updateMany count=0)이면 409 CONCURRENT_MODIFICATION", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder });
    soUpdateMany.mockResolvedValue({ count: 0 });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "CONCURRENT_MODIFICATION" });
    expect(sendVendorResponseOperatorNotifications).not.toHaveBeenCalled();
  });
});

describe("벤더 티켓 삭제 DELETE", () => {
  it("본인 주문의 티켓 제거 성공", async () => {
    soFindUnique.mockResolvedValue({
      id: "so-1",
      type: "TICKET",
      status: "CONFIRMED",
      vendorId: "v-1",
      ticketUrls: ["/u/a.jpg", "/u/b.jpg"],
    });
    const res = await VENDOR_DELETE(jsonReq({ url: "/u/a.jpg" }), P("so-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).ticketUrls).toEqual(["/u/b.jpg"]);
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it("없는 url이면 404 TICKET_NOT_FOUND", async () => {
    soFindUnique.mockResolvedValue({
      id: "so-1",
      type: "TICKET",
      status: "CONFIRMED",
      vendorId: "v-1",
      ticketUrls: ["/u/a.jpg"],
    });
    const res = await VENDOR_DELETE(jsonReq({ url: "/u/zzz.jpg" }), P("so-1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "TICKET_NOT_FOUND" });
    expect(soUpdateMany).not.toHaveBeenCalled();
  });
});

describe("운영자 대리 티켓 업로드 POST — 상태 불변", () => {
  it("발주 상태 전이 없이 ticketUrls만 append", async () => {
    soFindUnique.mockResolvedValue({
      id: "so-1",
      type: "TICKET",
      status: "REQUESTED",
      ticketUrls: [],
      ticketsIssuedAt: null,
    });
    const res = await ADMIN_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const call = soUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    // 상태 전이 필드 없음 — 단순 첨부
    expect(call.data.vendorStatus).toBeUndefined();
    expect(call.data.status).toBeUndefined();
    expect(call.data.ticketUrls).toEqual(["/u/a.jpg", "/u/b.jpg"]);
    expect(call.data.ticketsIssuedAt).toBeInstanceOf(Date);
    // 벤더 수락 통보 헬퍼는 운영자 경로에서 호출되지 않음
    expect(sendVendorResponseOperatorNotifications).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalled();
  });
});
