// 게스트 부가옵션 직접 발주·자동 확정·셀프 취소 확장 테스트 (ADR-0033)
//   - POST 자동 발주: 승인·활성 벤더면 생성 시 vendorStatus=PENDING_VENDOR + 벤더 통보. 미승인이면 폴백.
//   - 셀프 취소 확장: PENDING_VENDOR(벤더 미수락)는 취소 허용 + 벤더 취소 통보. VENDOR_ACCEPTED는 409.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma mock ──
const tokenFindUnique = vi.fn();
const tokenUpdate = vi.fn();
const catalogFindUnique = vi.fn();
const soCreate = vi.fn();
const soFindFirst = vi.fn();
const soUpdateMany = vi.fn();
const bookingFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: {
      findUnique: (...a: unknown[]) => tokenFindUnique(...a),
      update: (...a: unknown[]) => tokenUpdate(...a),
    },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
    serviceOrder: {
      create: (...a: unknown[]) => soCreate(...a),
      findFirst: (...a: unknown[]) => soFindFirst(...a),
      updateMany: (...a: unknown[]) => soUpdateMany(...a),
    },
    booking: { findUnique: (...a: unknown[]) => bookingFindUnique(...a) },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

vi.mock("@/lib/guest-checkin", () => ({ guestTokenState: () => "OK" }));
vi.mock("@/lib/guest-rate-limit", () => ({ guestRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/csrf", () => ({ assertSameOrigin: vi.fn(async () => null) }));

const sendVendorPoNotifications = vi.fn((..._a: unknown[]) => Promise.resolve({ zaloSent: true }));
const sendVendorPoCancelledNotifications = vi.fn((..._a: unknown[]) => Promise.resolve({ zaloSent: true }));
vi.mock("@/lib/vendor-dispatch", () => ({
  sendVendorPoNotifications: (...a: unknown[]) => sendVendorPoNotifications(...a),
  sendVendorPoCancelledNotifications: (...a: unknown[]) => sendVendorPoCancelledNotifications(...a),
}));

// POST 경로 순수 의존성 mock
const notifyOperators = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/consumer-signal-notify", () => ({
  notifyOperatorsServiceOrderRequested: (...a: unknown[]) => notifyOperators(...a),
}));
vi.mock("@/lib/service-catalog", () => {
  class ServiceSelectionError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    parseCatalogOptions: () => ({ variants: [], addons: [], modifiers: [] }),
    resolveOrderPricing: () => ({ totalPriceVnd: 500000n, quantity: 1, snapshot: { variants: [] } }),
    ServiceSelectionError,
    parseAudiences: () => ["GUEST"],
  };
});
vi.mock("@/lib/service-display", () => ({ priceKrwCeil: () => 0 }));
vi.mock("@/lib/pricing", () => ({ getFxVndPerKrw: async () => null }));
vi.mock("@/lib/date-vn", () => ({ parseUtcDateOnly: () => new Date("2026-08-01T00:00:00Z") }));

import { POST as CREATE } from "@/app/api/g/[token]/service-orders/route";
import { POST as CANCEL } from "@/app/api/g/[token]/service-orders/[id]/cancel/route";

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const emptyReq = () => new Request("http://local/x", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  tokenFindUnique.mockResolvedValue({
    bookingId: "bk-1",
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
    firstUsedAt: new Date(),
  });
  soCreate.mockResolvedValue({ id: "so-new" });
  bookingFindUnique.mockResolvedValue({ villa: { name: "Villa A", address: "123 St" } });
  sendVendorPoNotifications.mockResolvedValue({ zaloSent: true });
  sendVendorPoCancelledNotifications.mockResolvedValue({ zaloSent: true });
});

const createBody = {
  catalogItemId: "ci-1",
  quantity: 1,
  serviceDate: "2026-08-01",
  serviceTime: "14:00",
  liabilityConsent: true,
};

describe("게스트 주문 생성 자동 발주", () => {
  it("승인·활성 벤더면 vendorStatus=PENDING_VENDOR·poSentAt 저장 + 벤더 발주 통보", async () => {
    catalogFindUnique.mockResolvedValue({
      id: "ci-1",
      active: true,
      audiences: null,
      type: "MASSAGE",
      nameKo: "마사지",
      priceVnd: 500000n,
      options: null,
      vendorId: "v-1",
      vendor: {
        id: "v-1",
        userId: "vu-1",
        approvalStatus: "APPROVED",
        active: true,
        user: { zaloUserId: "z-1", locale: "vi" },
      },
    });

    const res = await CREATE(jsonReq(createBody), { params: Promise.resolve({ token: "tok" }) });
    expect(res.status).toBe(201);
    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data).toMatchObject({ vendorStatus: "PENDING_VENDOR" });
    expect(createArg.data.poSentAt).toBeInstanceOf(Date);
    expect(sendVendorPoNotifications).toHaveBeenCalledOnce();
    // 운영자 A1 알림은 유지
    expect(notifyOperators).toHaveBeenCalledOnce();
    // 감사로그에 자동 발주 필드 기록
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ vendorStatus: { new: "PENDING_VENDOR" } }),
      })
    );
  });

  it("미승인 벤더면 자동 발주 안 함(REQUESTED만) — 벤더 통보 없음", async () => {
    catalogFindUnique.mockResolvedValue({
      id: "ci-1",
      active: true,
      audiences: null,
      type: "MASSAGE",
      nameKo: "마사지",
      priceVnd: 500000n,
      options: null,
      vendorId: "v-1",
      vendor: {
        id: "v-1",
        userId: "vu-1",
        approvalStatus: "PENDING_APPROVAL",
        active: true,
        user: { zaloUserId: "z-1", locale: "vi" },
      },
    });

    const res = await CREATE(jsonReq(createBody), { params: Promise.resolve({ token: "tok" }) });
    expect(res.status).toBe(201);
    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data).not.toHaveProperty("vendorStatus");
    expect(createArg.data).not.toHaveProperty("poSentAt");
    expect(sendVendorPoNotifications).not.toHaveBeenCalled();
    expect(notifyOperators).toHaveBeenCalledOnce();
  });

  it("벤더 미배정(vendorId null)이면 자동 발주 안 함", async () => {
    catalogFindUnique.mockResolvedValue({
      id: "ci-1",
      active: true,
      audiences: null,
      type: "BBQ",
      nameKo: "BBQ",
      priceVnd: 500000n,
      options: null,
      vendorId: null,
      vendor: null,
    });

    const res = await CREATE(jsonReq(createBody), { params: Promise.resolve({ token: "tok" }) });
    expect(res.status).toBe(201);
    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data).not.toHaveProperty("vendorStatus");
    expect(sendVendorPoNotifications).not.toHaveBeenCalled();
  });
});

describe("게스트 주문 이용자 이름(customerName)", () => {
  const approvedVendorItem = {
    id: "ci-1",
    active: true,
    audiences: null,
    type: "MASSAGE",
    nameKo: "마사지",
    priceVnd: 500000n,
    options: null,
    vendorId: "v-1",
    vendor: {
      id: "v-1",
      userId: "vu-1",
      approvalStatus: "APPROVED",
      active: true,
      user: { zaloUserId: "z-1", locale: "vi" },
    },
  };

  it("입력한 이용자 이름을 저장하고 벤더 통보에 전달", async () => {
    catalogFindUnique.mockResolvedValue(approvedVendorItem);
    bookingFindUnique.mockResolvedValue({ guestName: "대표자", villa: { name: "Villa A", address: "123 St" } });

    const res = await CREATE(jsonReq({ ...createBody, customerName: "김철수" }), {
      params: Promise.resolve({ token: "tok" }),
    });
    expect(res.status).toBe(201);
    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.customerName).toBe("김철수");
    // 벤더 발주 통보에도 이용자 이름 전달
    expect(sendVendorPoNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: "김철수" })
    );
  });

  it("이용자 이름 빈값이면 예약 대표자(guestName) 폴백", async () => {
    catalogFindUnique.mockResolvedValue(approvedVendorItem);
    bookingFindUnique.mockResolvedValue({ guestName: "대표자", villa: { name: "Villa A", address: "123 St" } });

    // 공백만 입력 → trim 후 빈값 → 대표자 폴백
    const res = await CREATE(jsonReq({ ...createBody, customerName: "  " }), {
      params: Promise.resolve({ token: "tok" }),
    });
    expect(res.status).toBe(201);
    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.customerName).toBe("대표자");
    expect(sendVendorPoNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: "대표자" })
    );
  });

  it("이용자 이름 80자 초과면 400(VALIDATION_FAILED)", async () => {
    catalogFindUnique.mockResolvedValue(approvedVendorItem);
    const res = await CREATE(jsonReq({ ...createBody, customerName: "가".repeat(81) }), {
      params: Promise.resolve({ token: "tok" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "VALIDATION_FAILED" });
    expect(soCreate).not.toHaveBeenCalled();
  });
});

describe("게스트 셀프 취소 확장", () => {
  const vendorRel = { userId: "vu-1", user: { zaloUserId: "z-1", locale: "vi" } };

  it("PENDING_VENDOR(벤더 미수락)는 취소 허용 + 벤더 발주취소 통보", async () => {
    soFindFirst.mockResolvedValue({
      id: "so-1",
      status: "REQUESTED",
      vendorStatus: "PENDING_VENDOR",
      poSentAt: new Date(),
      quantity: 1,
      serviceDate: null,
      catalogItemId: "ci-1",
      vendorName: null,
      vendor: vendorRel,
      booking: { villa: { name: "Villa A" } },
    });
    catalogFindUnique.mockResolvedValue({ nameKo: "마사지" });
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await CANCEL(emptyReq(), {
      params: Promise.resolve({ token: "tok", id: "so-1" }),
    });
    expect(res.status).toBe(200);
    // where OR에 PENDING_VENDOR 포함(원자성)
    const upd = soUpdateMany.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(upd.where.OR).toContainEqual({ vendorStatus: "PENDING_VENDOR" });
    expect(sendVendorPoCancelledNotifications).toHaveBeenCalledOnce();
  });

  it("VENDOR_ACCEPTED는 셀프 취소 불가(409 DISPATCHED) — 통보 없음", async () => {
    soFindFirst.mockResolvedValue({
      id: "so-2",
      status: "REQUESTED",
      vendorStatus: "VENDOR_ACCEPTED",
      poSentAt: new Date(),
      quantity: 1,
      serviceDate: null,
      catalogItemId: "ci-1",
      vendorName: null,
      vendor: vendorRel,
      booking: { villa: { name: "Villa A" } },
    });

    const res = await CANCEL(emptyReq(), {
      params: Promise.resolve({ token: "tok", id: "so-2" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "DISPATCHED" });
    expect(soUpdateMany).not.toHaveBeenCalled();
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
  });

  it("미발주(null)는 취소 허용 + 벤더 통보 없음(발주 안 됨)", async () => {
    soFindFirst.mockResolvedValue({
      id: "so-3",
      status: "REQUESTED",
      vendorStatus: null,
      poSentAt: null,
      quantity: 1,
      serviceDate: null,
      catalogItemId: "ci-1",
      vendorName: null,
      vendor: null,
      booking: { villa: { name: "Villa A" } },
    });
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await CANCEL(emptyReq(), {
      params: Promise.resolve({ token: "tok", id: "so-3" }),
    });
    expect(res.status).toBe(200);
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
  });
});
