// 무료 티켓(판매가 0)은 발행 불필요 — 게스트 생성 시 자동 확정·수락, 벤더 발주 통보 생략 (ADR-0034 §3-2)
//   - 무료 그룹: status=CONFIRMED + vendorStatus=VENDOR_ACCEPTED + poSentAt·vendorRespondedAt, 벤더 통보 0, 운영자 A1 유지
//   - 유료 그룹(같은 제출의 다른 주문): 기존 자동 발주 흐름(PENDING_VENDOR + 벤더 통보) 회귀 금지
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma mock ──
const tokenFindUnique = vi.fn();
const tokenUpdate = vi.fn();
const catalogFindUnique = vi.fn();
const soCreate = vi.fn();
const bookingFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: {
      findUnique: (...a: unknown[]) => tokenFindUnique(...a),
      update: (...a: unknown[]) => tokenUpdate(...a),
    },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
    serviceOrder: { create: (...a: unknown[]) => soCreate(...a) },
    booking: { findUnique: (...a: unknown[]) => bookingFindUnique(...a) },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

vi.mock("@/lib/guest-checkin", () => ({ guestTokenState: () => "OK" }));
vi.mock("@/lib/guest-rate-limit", () => ({ guestRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/csrf", () => ({ assertSameOrigin: vi.fn(async () => null) }));

const sendVendorPoNotifications = vi.fn((..._a: unknown[]) => Promise.resolve({ zaloSent: true }));
vi.mock("@/lib/vendor-dispatch", () => ({
  sendVendorPoNotifications: (...a: unknown[]) => sendVendorPoNotifications(...a),
}));

const notifyOperators = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/consumer-signal-notify", () => ({
  notifyOperatorsServiceOrderRequested: (...a: unknown[]) => notifyOperators(...a),
}));

// 가격 재계산 — 테스트별로 totalPriceVnd 제어(무료=0n, 유료=500000n).
const resolveOrderPricing = vi.fn();
vi.mock("@/lib/service-catalog", () => {
  class ServiceSelectionError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    parseCatalogOptions: () => ({ variants: [], addons: [], modifiers: [] }),
    resolveOrderPricing: (...a: unknown[]) => resolveOrderPricing(...a),
    ServiceSelectionError,
    parseAudiences: () => ["GUEST"],
  };
});
vi.mock("@/lib/service-display", () => ({ priceKrwCeil: () => 0 }));
vi.mock("@/lib/pricing", () => ({ getFxVndPerKrw: async () => null }));
vi.mock("@/lib/date-vn", () => ({
  parseUtcDateOnly: () => new Date("2026-08-01T00:00:00Z"),
  toDateOnlyString: () => "2026-08-01",
}));
// 지역 벤더 해석 — TICKET은 카탈로그 기본(itemVendorId) 반환. 결정적으로 고정.
const resolveOrderVendorId = vi.fn();
vi.mock("@/lib/regional-vendor", () => ({
  resolveOrderVendorId: (...a: unknown[]) => resolveOrderVendorId(...a),
}));

import { POST as CREATE } from "@/app/api/g/[token]/service-orders/route";

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const approvedVendor = {
  id: "v-1",
  userId: "vu-1",
  approvalStatus: "APPROVED",
  active: true,
  user: { zaloUserId: "z-1", locale: "vi" },
};

const ticketItem = (priceVnd: bigint) => ({
  id: "ci-1",
  active: true,
  audiences: null,
  type: "TICKET",
  nameKo: "빈원더스 입장권",
  priceVnd,
  options: null,
  vendorId: "v-1",
  vendor: approvedVendor,
});

const createBody = {
  catalogItemId: "ci-1",
  quantity: 1,
  serviceDate: "2026-08-01",
  // TICKET은 이용일만 — serviceTime 없이도 통과
};

beforeEach(() => {
  vi.clearAllMocks();
  tokenFindUnique.mockResolvedValue({
    bookingId: "bk-1",
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
    firstUsedAt: new Date(),
  });
  soCreate.mockResolvedValue({ id: "so-new" });
  bookingFindUnique.mockResolvedValue({ guestName: "대표자", villa: { id: "vl-1", name: "Villa A", address: "123 St" } });
  sendVendorPoNotifications.mockResolvedValue({ zaloSent: true });
  resolveOrderVendorId.mockResolvedValue("v-1");
});

describe("무료 티켓(판매가 0) 자동 확정 — 발행·발주 통보 불필요", () => {
  it("무료 그룹: status=CONFIRMED·vendorStatus=VENDOR_ACCEPTED·poSentAt·vendorRespondedAt, 벤더 통보 0·운영자 A1 유지", async () => {
    catalogFindUnique.mockResolvedValue(ticketItem(0n));
    resolveOrderPricing.mockReturnValue({ totalPriceVnd: 0n, quantity: 1, snapshot: { variants: [] } });

    const res = await CREATE(jsonReq(createBody), { params: Promise.resolve({ token: "tok" }) });
    expect(res.status).toBe(201);

    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data).toMatchObject({
      status: "CONFIRMED",
      vendorStatus: "VENDOR_ACCEPTED",
    });
    expect(createArg.data.poSentAt).toBeInstanceOf(Date);
    expect(createArg.data.vendorRespondedAt).toBeInstanceOf(Date);
    // vendorId는 정상 스냅샷(예약현황 노출용)
    expect(createArg.data.vendorId).toBe("v-1");

    // ★벤더 발주 통보 생략(할 일 아님)
    expect(sendVendorPoNotifications).not.toHaveBeenCalled();
    // 운영자 신청 접수 알림(A1)은 유지
    expect(notifyOperators).toHaveBeenCalledOnce();
    // 감사로그에 무료 확정 필드 기록
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          status: { new: "CONFIRMED" },
          vendorStatus: { new: "VENDOR_ACCEPTED" },
        }),
      })
    );
  });

  it("유료 티켓(판매가 > 0)은 기존 자동 발주 흐름 그대로(PENDING_VENDOR + 벤더 통보) — 회귀 없음", async () => {
    catalogFindUnique.mockResolvedValue(ticketItem(500000n));
    resolveOrderPricing.mockReturnValue({ totalPriceVnd: 500000n, quantity: 1, snapshot: { variants: [] } });

    const res = await CREATE(jsonReq(createBody), { params: Promise.resolve({ token: "tok" }) });
    expect(res.status).toBe(201);

    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data).toMatchObject({ vendorStatus: "PENDING_VENDOR" });
    expect(createArg.data.poSentAt).toBeInstanceOf(Date);
    // 유료는 무료 확정 필드가 없어야 함(status는 기본 REQUESTED 유지)
    expect(createArg.data.status).toBe("REQUESTED");
    expect(createArg.data).not.toHaveProperty("vendorRespondedAt");
    // 유료는 벤더 발주 통보 발송
    expect(sendVendorPoNotifications).toHaveBeenCalledOnce();
    expect(notifyOperators).toHaveBeenCalledOnce();
  });
});
