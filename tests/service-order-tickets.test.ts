// 티켓형(TICKET) QR 티켓 발행/삭제 API 테스트 (ADR-0034, 완료 게이트 개정 2026-07-12 + 발행=완료 §3-3)
//   - 벤더 업로드: 성공 + 발행=수락 겸행 전이(수량 충족 시만·GUEST→CONFIRMED)·미달 업로드=PENDING 유지·통보 미발송
//     ·나눠 업로드 충족 시 전이·초과 업로드 전이·타벤더 404·비TICKET 400·상한 400·CANCELLED 409·동시성 409
//   - 발행=완료(§3-3): 수량 충족 시 vendorCompletedAt 자동 세팅(수락과 동시/수락 후 추가발행 둘 다)·미달=미기록·이미 완료면 재기록 없음
//   - 벤더 삭제: 성공·미존재 404·미달 시 vendorCompletedAt 해제(수락 유지)·초과분 삭제로도 충족이면 완료 유지
//   - 운영자 대리 업로드: 상태 불변(전이·완료 없음)
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
  vendorCompletedAt: null as Date | null,
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
    // ★발행=완료(§3-3): 수락 전이와 동시에 vendorCompletedAt 세팅
    expect(call.data.vendorCompletedAt).toBeInstanceOf(Date);
    expect(body.vendorCompletedAt).toBeTruthy();
    expect(sendVendorResponseOperatorNotifications).toHaveBeenCalledOnce();
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it("requestedVia=ADMIN 티켓 발행 완료 → 수락+CONFIRMED+완료 동시(requestedVia 무관, ADR-0034 §3-4)", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder, requestedVia: "ADMIN" });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(body.status).toBe("CONFIRMED");
    const call = soUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    // 운영자 발주라도 status=REQUESTED 가드 + CONFIRMED 전이(원자)
    expect(call.where.vendorStatus).toBe("PENDING_VENDOR");
    expect(call.where.status).toBe("REQUESTED");
    expect(call.data.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(call.data.status).toBe("CONFIRMED");
    expect(call.data.vendorCompletedAt).toBeInstanceOf(Date);
    expect(body.vendorCompletedAt).toBeTruthy();
    expect(sendVendorResponseOperatorNotifications).toHaveBeenCalledOnce();
  });

  it("requestedVia=PARTNER 티켓 발행 완료 → 수락+CONFIRMED+완료 동시", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder, requestedVia: "PARTNER" });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(body.status).toBe("CONFIRMED");
    const call = soUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(call.where.status).toBe("REQUESTED");
    expect(call.data.status).toBe("CONFIRMED");
    expect(call.data.vendorCompletedAt).toBeInstanceOf(Date);
    expect(sendVendorResponseOperatorNotifications).toHaveBeenCalledOnce();
  });

  it("완료 게이트: 2장 주문에 1장만 발행 → PENDING 유지·전이 미발생·통보 미발송(발주함 잔류)", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder }); // quantity 2, ticketUrls []
    saveTicketFiles.mockResolvedValue({ ok: true, urls: ["/u/a.jpg"] }); // 1장만
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticketUrls).toEqual(["/u/a.jpg"]);
    // 미달 → 전이 없음: 상태 그대로
    expect(body.vendorStatus).toBe("PENDING_VENDOR");
    expect(body.status).toBe("REQUESTED");
    const call = soUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    // 전이 가드·필드 없음 — ticketUrls만 append. 최초 발행 시각은 기록.
    //   where.status는 base 가드({notIn:...})만 — autoConfirm REQUESTED 가드는 없음.
    expect(call.where.vendorStatus).toBeUndefined();
    expect(call.where.status).not.toBe("REQUESTED");
    expect(call.data.vendorStatus).toBeUndefined();
    expect(call.data.status).toBeUndefined();
    expect(call.data.ticketUrls).toEqual(["/u/a.jpg"]);
    expect(call.data.ticketsIssuedAt).toBeInstanceOf(Date);
    // ★미달이라 완료도 미기록
    expect(call.data.vendorCompletedAt).toBeUndefined();
    expect(body.vendorCompletedAt).toBeNull();
    expect(sendVendorResponseOperatorNotifications).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalled(); // 발행 자체는 감사 기록
  });

  it("완료 게이트: 1장 발행 후 1장 더 발행해 수량 충족 → VENDOR_ACCEPTED + CONFIRMED 전이 + 통보 1회", async () => {
    // 이미 1장 발행돼 있고(PENDING 유지·최초 발행 시각 있음) 두 번째 업로드로 2/2 충족.
    soFindUnique.mockResolvedValue({
      ...baseTicketOrder,
      ticketUrls: ["/u/a.jpg"],
      ticketsIssuedAt: new Date(),
    });
    saveTicketFiles.mockResolvedValue({ ok: true, urls: ["/u/b.jpg"] });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticketUrls).toEqual(["/u/a.jpg", "/u/b.jpg"]);
    expect(body.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(body.status).toBe("CONFIRMED");
    const call = soUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(call.where.vendorStatus).toBe("PENDING_VENDOR");
    expect(call.where.status).toBe("REQUESTED");
    expect(call.data.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(call.data.status).toBe("CONFIRMED");
    expect(call.data.ticketsIssuedAt).toBeUndefined(); // 최초 발행 시각 유지(두 번째라 갱신 안 함)
    expect(call.data.vendorCompletedAt).toBeInstanceOf(Date); // 충족 순간 완료 자동 세팅
    expect(sendVendorResponseOperatorNotifications).toHaveBeenCalledOnce();
  });

  it("초과 발행(2장 주문에 3장) → ≥ 조건 충족이라 전이 정상", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder });
    saveTicketFiles.mockResolvedValue({ ok: true, urls: ["/u/a.jpg", "/u/b.jpg", "/u/c.jpg"] });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(body.status).toBe("CONFIRMED");
    const call = soUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(sendVendorResponseOperatorNotifications).toHaveBeenCalledOnce();
  });

  it("이미 VENDOR_ACCEPTED·완료된 주문의 추가 발행 → 전이·완료·통보 없음(순수 첨부)", async () => {
    soFindUnique.mockResolvedValue({
      ...baseTicketOrder,
      status: "CONFIRMED",
      vendorStatus: "VENDOR_ACCEPTED",
      ticketUrls: ["/u/existing.jpg", "/u/existing2.jpg"], // 이미 2/2 충족
      ticketsIssuedAt: new Date(),
      vendorCompletedAt: new Date(), // 이미 완료됨
    });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(body.status).toBe("CONFIRMED");
    expect(body.ticketUrls).toHaveLength(4); // 기존 2 + 신규 2
    const call = soUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(call.where.vendorStatus).toBeUndefined();
    expect(call.data.vendorStatus).toBeUndefined();
    expect(call.data.ticketsIssuedAt).toBeUndefined(); // 최초 발행 시각 유지
    expect(call.data.vendorCompletedAt).toBeUndefined(); // 이미 완료 → 재기록 없음(멱등)
    expect(sendVendorResponseOperatorNotifications).not.toHaveBeenCalled();
  });

  it("수동 수락된 미달(1/2) 주문에 추가 발행으로 충족 → vendorCompletedAt만 세팅·vendorStatus 불변·통보 없음 (§3-3 케이스 b)", async () => {
    // 확인시트 등으로 1장만 발행된 채 수동 수락(VENDOR_ACCEPTED)된 상태. 두 번째 발행으로 2/2 충족.
    soFindUnique.mockResolvedValue({
      ...baseTicketOrder,
      status: "CONFIRMED",
      vendorStatus: "VENDOR_ACCEPTED",
      ticketUrls: ["/u/a.jpg"],
      ticketsIssuedAt: new Date(),
      vendorCompletedAt: null, // 아직 완료 미기록
    });
    saveTicketFiles.mockResolvedValue({ ok: true, urls: ["/u/b.jpg"] });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vendorStatus).toBe("VENDOR_ACCEPTED"); // 전이 없음(이미 수락)
    expect(body.status).toBe("CONFIRMED");
    expect(body.vendorCompletedAt).toBeTruthy();
    const call = soUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    // 상태 전이 가드·필드 없음 — 완료 필드만 조건부 추가
    expect(call.where.vendorStatus).toBeUndefined();
    expect(call.data.vendorStatus).toBeUndefined();
    expect(call.data.status).toBeUndefined();
    expect(call.data.vendorCompletedAt).toBeInstanceOf(Date);
    expect(sendVendorResponseOperatorNotifications).not.toHaveBeenCalled(); // 완료 통보 없음(수락 통보로 충분)
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

  it("VENDOR_REJECTED(거절한 발주)면 409 ORDER_REJECTED — 저장 안 함 (QA P3)", async () => {
    soFindUnique.mockResolvedValue({ ...baseTicketOrder, vendorStatus: "VENDOR_REJECTED" });
    const res = await VENDOR_POST(formReq(), P("so-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ORDER_REJECTED" });
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
  it("본인 주문의 티켓 제거 성공(여전히 충족 — 완료 유지)", async () => {
    // 초과분(3장) 중 1장 삭제 → 2/2 여전히 충족이라 완료 유지.
    soFindUnique.mockResolvedValue({
      id: "so-1",
      type: "TICKET",
      status: "CONFIRMED",
      vendorId: "v-1",
      ticketUrls: ["/u/a.jpg", "/u/b.jpg", "/u/c.jpg"],
      quantity: 2,
      vendorCompletedAt: new Date(),
    });
    const res = await VENDOR_DELETE(jsonReq({ url: "/u/a.jpg" }), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticketUrls).toEqual(["/u/b.jpg", "/u/c.jpg"]);
    expect(body.vendorCompletedAt).toBeTruthy(); // 여전히 2/2 → 완료 유지
    const call = soUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.vendorCompletedAt).toBeUndefined(); // 해제 필드 없음
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it("삭제로 수량 미달 → vendorCompletedAt null 해제(수락 상태·status 불변) (§3-3 대칭)", async () => {
    soFindUnique.mockResolvedValue({
      id: "so-1",
      type: "TICKET",
      status: "CONFIRMED",
      vendorId: "v-1",
      ticketUrls: ["/u/a.jpg", "/u/b.jpg"],
      quantity: 2,
      vendorCompletedAt: new Date(),
    });
    const res = await VENDOR_DELETE(jsonReq({ url: "/u/a.jpg" }), P("so-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticketUrls).toEqual(["/u/b.jpg"]); // 1/2 미달
    expect(body.vendorCompletedAt).toBeNull(); // 완료 해제
    const call = soUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.vendorCompletedAt).toBeNull();
    // 수락·상태 축은 건드리지 않음(un-accept 없음)
    expect(call.data.vendorStatus).toBeUndefined();
    expect(call.data.status).toBeUndefined();
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it("미완료(vendorCompletedAt null) 주문 삭제 → 해제 필드 없음(불변)", async () => {
    soFindUnique.mockResolvedValue({
      id: "so-1",
      type: "TICKET",
      status: "CONFIRMED",
      vendorId: "v-1",
      ticketUrls: ["/u/a.jpg", "/u/b.jpg"],
      quantity: 2,
      vendorCompletedAt: null,
    });
    const res = await VENDOR_DELETE(jsonReq({ url: "/u/a.jpg" }), P("so-1"));
    expect(res.status).toBe(200);
    const call = soUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.vendorCompletedAt).toBeUndefined();
  });

  it("없는 url이면 404 TICKET_NOT_FOUND", async () => {
    soFindUnique.mockResolvedValue({
      id: "so-1",
      type: "TICKET",
      status: "CONFIRMED",
      vendorId: "v-1",
      ticketUrls: ["/u/a.jpg"],
      quantity: 2,
      vendorCompletedAt: null,
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
