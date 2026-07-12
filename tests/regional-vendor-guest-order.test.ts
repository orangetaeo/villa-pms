// 게스트 주문 생성 — 지역 지정 업체 오버라이드 + 자동 발주 대상 교체 (ADR-0037 × ADR-0033).
//   MASSAGE 주문에 이 빌라 지정 업체가 있으면 vendorId 스냅샷을 그 업체로 저장하고,
//   자동 발주 판정·Zalo 발송 대상도 그 업체 엔티티(재조회)로 교체됨을 검증.
import { describe, it, expect, vi, beforeEach } from "vitest";

const tokenFindUnique = vi.fn();
const tokenUpdate = vi.fn();
const catalogFindUnique = vi.fn();
const soCreate = vi.fn();
const bookingFindUnique = vi.fn();
const vsvFindUnique = vi.fn(); // villaServiceVendor — resolveOrderVendorId 조회
const vendorFindUnique = vi.fn(); // serviceVendor — 오버라이드 시 재조회
// ADR-0038 지역 커버리지 단계 ② — 수동 지정 없을 때 villa.complex 조회·지역 매칭. 이 스위트는
//   수동 지정 경로가 대상이라 complex=null(지역 매칭 스킵)로 기본 세팅해 폴백 의미 보존.
const villaFindUnique = vi.fn(async (..._a: unknown[]) => ({ complex: null }));
const svrFindMany = vi.fn(async (..._a: unknown[]) => []);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: {
      findUnique: (...a: unknown[]) => tokenFindUnique(...a),
      update: (...a: unknown[]) => tokenUpdate(...a),
    },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
    serviceOrder: { create: (...a: unknown[]) => soCreate(...a) },
    booking: { findUnique: (...a: unknown[]) => bookingFindUnique(...a) },
    villaServiceVendor: { findUnique: (...a: unknown[]) => vsvFindUnique(...a) },
    villa: { findUnique: (...a: unknown[]) => villaFindUnique(...a) },
    serviceVendorRegion: { findMany: (...a: unknown[]) => svrFindMany(...a) },
    serviceVendor: { findUnique: (...a: unknown[]) => vendorFindUnique(...a) },
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

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const createBody = { catalogItemId: "ci-1", quantity: 1, serviceDate: "2026-08-01", serviceTime: "14:00" };

// 카탈로그 기본 벤더 = v-catalog(승인·활성). 지역 지정 업체 = v-regional.
const catalogItem = {
  id: "ci-1",
  active: true,
  audiences: null,
  type: "MASSAGE",
  nameKo: "마사지",
  priceVnd: 500000n,
  options: null,
  vendorId: "v-catalog",
  vendor: {
    id: "v-catalog",
    userId: "u-catalog",
    approvalStatus: "APPROVED",
    active: true,
    user: { zaloUserId: "z-catalog", locale: "vi" },
  },
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
  bookingFindUnique.mockResolvedValue({
    guestName: "대표자",
    villa: { id: "villa-1", name: "Villa A", address: "123 St" },
  });
  catalogFindUnique.mockResolvedValue(catalogItem);
  sendVendorPoNotifications.mockResolvedValue({ zaloSent: true });
});

describe("게스트 MASSAGE 주문 — 지역 지정 업체 오버라이드", () => {
  it("빌라 지정 업체가 있으면 vendorId 스냅샷·자동 발주 대상 모두 그 업체로 교체", async () => {
    // 지역 매핑 존재 → v-regional
    vsvFindUnique.mockResolvedValue({ vendorId: "v-regional" });
    // 오버라이드 벤더 재조회 → 승인·활성·Zalo
    vendorFindUnique.mockResolvedValue({
      id: "v-regional",
      userId: "u-regional",
      approvalStatus: "APPROVED",
      active: true,
      user: { zaloUserId: "z-regional", locale: "vi" },
    });

    const res = await CREATE(jsonReq(createBody), { params: Promise.resolve({ token: "tok" }) });
    expect(res.status).toBe(201);

    // vendorId 스냅샷 = 지역 업체
    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.vendorId).toBe("v-regional");
    expect(createArg.data.vendorStatus).toBe("PENDING_VENDOR");

    // 지역 업체 엔티티를 같은 select로 재조회했는가
    expect(vendorFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v-regional" } }),
    );
    // 자동 발주 통보 대상 = 지역 업체(카탈로그 기본 아님)
    expect(sendVendorPoNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ vendor: expect.objectContaining({ id: "v-regional" }) }),
    );
  });

  it("지역 업체가 미승인이면 자동 발주 안 함(REQUESTED만) — vendorId는 여전히 지역 업체 스냅샷", async () => {
    vsvFindUnique.mockResolvedValue({ vendorId: "v-regional" });
    vendorFindUnique.mockResolvedValue({
      id: "v-regional",
      userId: "u-regional",
      approvalStatus: "PENDING_APPROVAL",
      active: true,
      user: { zaloUserId: "z-regional", locale: "vi" },
    });

    const res = await CREATE(jsonReq(createBody), { params: Promise.resolve({ token: "tok" }) });
    expect(res.status).toBe(201);
    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.vendorId).toBe("v-regional");
    expect(createArg.data).not.toHaveProperty("vendorStatus");
    expect(sendVendorPoNotifications).not.toHaveBeenCalled();
  });

  it("지역 매핑 없으면 카탈로그 기본 업체 폴백 — 재조회 생략, 카탈로그 벤더로 자동 발주", async () => {
    vsvFindUnique.mockResolvedValue(null);

    const res = await CREATE(jsonReq(createBody), { params: Promise.resolve({ token: "tok" }) });
    expect(res.status).toBe(201);
    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.vendorId).toBe("v-catalog");
    // 오버라이드 없음 → serviceVendor 재조회 생략
    expect(vendorFindUnique).not.toHaveBeenCalled();
    expect(sendVendorPoNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ vendor: expect.objectContaining({ id: "v-catalog" }) }),
    );
  });

  it("비지역 타입(BBQ)은 지역 조회 생략 — 카탈로그 기본 그대로", async () => {
    catalogFindUnique.mockResolvedValue({
      ...catalogItem,
      type: "BBQ",
      vendorId: "v-bbq",
      vendor: { ...catalogItem.vendor, id: "v-bbq", userId: "u-bbq" },
    });

    const res = await CREATE(jsonReq(createBody), { params: Promise.resolve({ token: "tok" }) });
    expect(res.status).toBe(201);
    const createArg = soCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.vendorId).toBe("v-bbq");
    expect(vsvFindUnique).not.toHaveBeenCalled();
    expect(vendorFindUnique).not.toHaveBeenCalled();
  });
});
