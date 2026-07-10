// 부가서비스 발주 동시성 가드 회귀 테스트 (debug-sweep / PR#82 재이식)
//   세 라우트(service-orders PATCH·dispatch·vendor respond)는 읽기 스냅샷 위에서 전이를 판정한 뒤
//   updateMany({where:{...상태...}}) 로 DB 레벨 재확인한다. 그 사이 다른 요청이 상태를 바꿔
//   count===0 이면 409 CONCURRENT_MODIFICATION 으로 막고, 부수효과(Zalo 발주·운영자 통지)도 내지 않는다.
import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));

const soFindUnique = vi.fn();
const soUpdateMany = vi.fn();
const catalogFindUnique = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceOrder: {
      findUnique: (...a: unknown[]) => soFindUnique(...a),
      updateMany: (...a: unknown[]) => soUpdateMany(...a),
    },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

const enqueueNotification = vi.fn();
vi.mock("@/lib/zalo", () => ({
  enqueueNotification: (...a: unknown[]) => enqueueNotification(...a),
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

const getVendorIdForUser = vi.fn();
vi.mock("@/lib/vendor-auth", () => ({
  getVendorIdForUser: (...a: unknown[]) => getVendorIdForUser(...a),
}));

// 인앱 알림(벨) — 실제 구현이 prisma를 건드리지 않게 no-op mock. 라우트는 이 결과를 try/catch로 감싼다.
vi.mock("@/lib/inapp-notification", () => ({
  enqueueInAppNotification: vi.fn(async () => {}),
  enqueueInAppForOperators: vi.fn(async () => {}),
  buildVendorNotifText: () => ({ title: "t", body: "b" }),
  buildAdminNotifText: () => ({ title: "t", body: "b" }),
  vendorNotifLocale: () => "vi",
}));

import { PATCH } from "@/app/api/service-orders/[id]/route";
import { POST as DISPATCH } from "@/app/api/service-orders/[id]/dispatch/route";
import { POST as RESPOND } from "@/app/api/vendor/orders/[id]/respond/route";

const ADMIN = { user: { id: "admin-1", role: "ADMIN" } };
const VENDOR = { user: { id: "vu-1", role: "VENDOR" } };

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  catalogFindUnique.mockResolvedValue({ nameKo: "과일바구니" });
  userFindMany.mockResolvedValue([{ id: "op-1" }]);
});

describe("service-orders PATCH 동시성 가드", () => {
  const baseOrder = {
    id: "so-1",
    status: "REQUESTED",
    vendorId: null,
    vendorStatus: null,
    proposedServiceDate: null,
    vendorProposalRespondedAt: null,
    booking: { status: "CONFIRMED" },
  };

  it("그 사이 상태가 바뀌어 updateMany count===0 이면 409", async () => {
    auth.mockResolvedValue(ADMIN);
    soFindUnique.mockResolvedValue(baseOrder);
    soUpdateMany.mockResolvedValue({ count: 0 }); // 다른 요청이 먼저 전이시킴

    const res = await PATCH(jsonReq({ status: "CANCELLED" }), {
      params: Promise.resolve({ id: "so-1" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "CONCURRENT_MODIFICATION" });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("정상 전이는 200 + 감사로그", async () => {
    auth.mockResolvedValue(ADMIN);
    soFindUnique.mockResolvedValue(baseOrder);
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await PATCH(jsonReq({ status: "CANCELLED" }), {
      params: Promise.resolve({ id: "so-1" }),
    });
    expect(res.status).toBe(200);
    expect(soUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "so-1", status: "REQUESTED" } })
    );
    expect(writeAuditLog).toHaveBeenCalledOnce();
  });
});

describe("dispatch 동시성 가드 (이중 발주 차단)", () => {
  const baseOrder = {
    id: "so-2",
    status: "REQUESTED",
    vendorId: "v-1",
    vendorStatus: null,
    serviceDate: null,
    serviceTime: null,
    quantity: 1,
    costVnd: 0n,
    selectedOptions: null,
    catalogItemId: "ci-1",
    vendorName: null,
    guestNote: null,
    vendor: {
      id: "v-1",
      name: "V",
      userId: "vu-1",
      approvalStatus: "APPROVED",
      user: { zaloUserId: "z-1", locale: "vi" },
    },
    booking: { villa: { name: "V11", address: null } },
  };

  it("count===0 이면 409 이고 Zalo 발주를 enqueue 하지 않는다", async () => {
    auth.mockResolvedValue(ADMIN);
    soFindUnique.mockResolvedValue(baseOrder);
    soUpdateMany.mockResolvedValue({ count: 0 }); // 동시 발주가 먼저 점유

    const res = await DISPATCH(new Request("http://local/x", { method: "POST" }), {
      params: Promise.resolve({ id: "so-2" }),
    });
    expect(res.status).toBe(409);
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("정상 발주는 200 + Zalo enqueue 1회", async () => {
    auth.mockResolvedValue(ADMIN);
    soFindUnique.mockResolvedValue(baseOrder);
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await DISPATCH(new Request("http://local/x", { method: "POST" }), {
      params: Promise.resolve({ id: "so-2" }),
    });
    expect(res.status).toBe(200);
    expect(enqueueNotification).toHaveBeenCalledOnce();
  });
});

describe("vendor respond 동시성 가드 (이중 응답 차단)", () => {
  const baseOrder = {
    id: "so-3",
    status: "REQUESTED",
    bookingId: "bk-1",
    vendorId: "v-1",
    vendorStatus: "PENDING_VENDOR",
    catalogItemId: "ci-1",
    vendorName: null,
    serviceDate: null,
    serviceTime: null,
    quantity: 1,
    costVnd: 0n,
    vendor: { name: "V", nameKo: "공급자" },
    booking: { villa: { name: "V11" } },
  };

  it("count===0 이면 409 이고 운영자 통지를 보내지 않는다", async () => {
    auth.mockResolvedValue(VENDOR);
    getVendorIdForUser.mockResolvedValue("v-1");
    soFindUnique.mockResolvedValue(baseOrder);
    soUpdateMany.mockResolvedValue({ count: 0 }); // 동시 수락/거절이 먼저 점유

    const res = await RESPOND(jsonReq({ action: "accept" }), {
      params: Promise.resolve({ id: "so-3" }),
    });
    expect(res.status).toBe(409);
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("정상 응답은 200 + 운영자 통지", async () => {
    auth.mockResolvedValue(VENDOR);
    getVendorIdForUser.mockResolvedValue("v-1");
    soFindUnique.mockResolvedValue(baseOrder);
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await RESPOND(jsonReq({ action: "accept" }), {
      params: Promise.resolve({ id: "so-3" }),
    });
    expect(res.status).toBe(200);
    expect(soUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "so-3", vendorId: "v-1", vendorStatus: "PENDING_VENDOR" },
      })
    );
    expect(enqueueNotification).toHaveBeenCalledOnce();
  });
});
