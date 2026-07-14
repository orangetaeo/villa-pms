// TICKET 판매가능 벤더 가드 테스트 (계약 ticket-vendor-required-sale-block)
//   - 순수 헬퍼: isVendorSellable / canSellItem(비TICKET 항상 허용·TICKET은 승인+활성 벤더 필수) / loadCanSellItem(조회 래퍼)
//   - 게스트 POST /api/g/[token]/service-orders: TICKET 미판매(미지정/미승인/비활성) → 400, 정상 → 201, 비TICKET 미지정 → 201(회귀), 무료 TICKET 미지정 → 400
//   - 운영자 POST /api/bookings/[id]/service-orders: 대칭(400/201)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isVendorSellable, canSellItem, loadCanSellItem } from "@/lib/ticket-vendor-guard";

// ── 순수 헬퍼 ─────────────────────────────────────────────────────────────────
describe("isVendorSellable (순수)", () => {
  it("APPROVED + active → true", () => {
    expect(isVendorSellable({ approvalStatus: "APPROVED", active: true })).toBe(true);
  });
  it("PENDING_APPROVAL → false", () => {
    expect(isVendorSellable({ approvalStatus: "PENDING_APPROVAL", active: true })).toBe(false);
  });
  it("APPROVED 이지만 비활성 → false", () => {
    expect(isVendorSellable({ approvalStatus: "APPROVED", active: false })).toBe(false);
  });
  it("null/undefined → false", () => {
    expect(isVendorSellable(null)).toBe(false);
    expect(isVendorSellable(undefined)).toBe(false);
    expect(isVendorSellable({ approvalStatus: null, active: null })).toBe(false);
  });
});

describe("canSellItem (순수)", () => {
  const ok = { approvalStatus: "APPROVED", active: true };
  it("비TICKET은 벤더 없어도 항상 판매 허용(직접 제공 모드 불변)", () => {
    expect(canSellItem({ itemType: "BBQ", resolvedVendorId: null, vendor: null })).toBe(true);
    expect(canSellItem({ itemType: "MASSAGE", resolvedVendorId: null, vendor: null })).toBe(true);
  });
  it("TICKET + 벤더 미지정(resolvedVendorId null) → 판매 불가", () => {
    expect(canSellItem({ itemType: "TICKET", resolvedVendorId: null, vendor: null })).toBe(false);
  });
  it("TICKET + 미승인 벤더 → 판매 불가", () => {
    expect(
      canSellItem({ itemType: "TICKET", resolvedVendorId: "v-1", vendor: { approvalStatus: "PENDING_APPROVAL", active: true } })
    ).toBe(false);
  });
  it("TICKET + 비활성 벤더 → 판매 불가", () => {
    expect(
      canSellItem({ itemType: "TICKET", resolvedVendorId: "v-1", vendor: { approvalStatus: "APPROVED", active: false } })
    ).toBe(false);
  });
  it("TICKET + 승인·활성 벤더 → 판매 허용", () => {
    expect(canSellItem({ itemType: "TICKET", resolvedVendorId: "v-1", vendor: ok })).toBe(true);
  });
});

describe("loadCanSellItem (조회 래퍼)", () => {
  it("비TICKET은 조회 없이 true", async () => {
    const findUnique = vi.fn();
    const db = { serviceVendor: { findUnique } } as never;
    await expect(loadCanSellItem({ itemType: "BBQ", resolvedVendorId: null }, db)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("TICKET + 벤더 미지정은 조회 없이 false", async () => {
    const findUnique = vi.fn();
    const db = { serviceVendor: { findUnique } } as never;
    await expect(loadCanSellItem({ itemType: "TICKET", resolvedVendorId: null }, db)).resolves.toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("TICKET + 승인·활성 벤더 조회 → true", async () => {
    const findUnique = vi.fn().mockResolvedValue({ approvalStatus: "APPROVED", active: true });
    const db = { serviceVendor: { findUnique } } as never;
    await expect(loadCanSellItem({ itemType: "TICKET", resolvedVendorId: "v-1" }, db)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledOnce();
  });
  it("TICKET + 미승인 벤더 조회 → false", async () => {
    const findUnique = vi.fn().mockResolvedValue({ approvalStatus: "PENDING_APPROVAL", active: true });
    const db = { serviceVendor: { findUnique } } as never;
    await expect(loadCanSellItem({ itemType: "TICKET", resolvedVendorId: "v-1" }, db)).resolves.toBe(false);
  });
  it("TICKET + 존재하지 않는 벤더(null) → false", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const db = { serviceVendor: { findUnique } } as never;
    await expect(loadCanSellItem({ itemType: "TICKET", resolvedVendorId: "v-gone" }, db)).resolves.toBe(false);
  });
});

// ── 라우트 통합 mock ─────────────────────────────────────────────────────────
const tokenFindUnique = vi.fn();
const tokenUpdate = vi.fn();
const catalogFindUnique = vi.fn();
const vendorFindUnique = vi.fn();
const soCreate = vi.fn();
const bookingFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: {
      findUnique: (...a: unknown[]) => tokenFindUnique(...a),
      update: (...a: unknown[]) => tokenUpdate(...a),
    },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
    serviceVendor: { findUnique: (...a: unknown[]) => vendorFindUnique(...a) },
    serviceOrder: { create: (...a: unknown[]) => soCreate(...a) },
    booking: { findUnique: (...a: unknown[]) => bookingFindUnique(...a) },
  },
}));

vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/guest-checkin", () => ({ guestTokenState: () => "OK" }));
vi.mock("@/lib/guest-rate-limit", () => ({ guestRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/csrf", () => ({ assertSameOrigin: vi.fn(async () => null) }));
vi.mock("@/lib/consumer-signal-notify", () => ({
  notifyOperatorsServiceOrderRequested: vi.fn(async () => {}),
}));
vi.mock("@/lib/vendor-dispatch", () => ({ sendVendorPoNotifications: vi.fn(async () => ({ zaloSent: true })) }));
vi.mock("@/lib/ticket-order-validation", () => ({ validateTicketGuests: vi.fn(async () => ({ ok: true, snapshot: null })) }));
vi.mock("@/lib/checkin-roster", () => ({ loadCheckinRoster: vi.fn(async () => []) }));
vi.mock("@/lib/service-display", () => ({ priceKrwCeil: () => 0 }));
vi.mock("@/lib/pricing", () => ({ getFxVndPerKrw: async () => null }));
vi.mock("@/lib/date-vn", () => ({
  parseUtcDateOnly: () => new Date("2026-08-01T00:00:00Z"),
  toDateOnlyString: () => "2026-08-01",
}));

const pricingTotal = { value: 500000n };
vi.mock("@/lib/service-catalog", () => {
  class ServiceSelectionError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    parseCatalogOptions: () => ({ variants: [], addons: [], modifiers: [] }),
    resolveOrderPricing: () => ({ totalPriceVnd: pricingTotal.value, quantity: 1, snapshot: [] }),
    ServiceSelectionError,
    parseAudiences: () => ["GUEST"],
  };
});

// 운영자 라우트 인가 — @/auth는 next-auth 로딩(테스트 환경 미지원)이라 mock으로 차단(POST는 requireCapability 사용)
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const requireCapability = vi.fn();
vi.mock("@/lib/api-guard", () => ({ requireCapability: (...a: unknown[]) => requireCapability(...a) }));
vi.mock("@/lib/permissions", () => ({
  isOperator: (r?: string) => r === "ADMIN",
  canViewFinance: () => false,
}));

import { POST as GUEST_POST } from "@/app/api/g/[token]/service-orders/route";
import { POST as ADMIN_POST } from "@/app/api/bookings/[id]/service-orders/route";

const guestReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const GP = (token: string) => ({ params: Promise.resolve({ token }) });
const AP = (id: string) => ({ params: Promise.resolve({ id }) });

const ticketBody = { catalogItemId: "ci-1", quantity: 1, serviceDate: "2026-08-01" };

const ticketItem = (over: Record<string, unknown> = {}) => ({
  id: "ci-1",
  active: true,
  audiences: null,
  type: "TICKET",
  nameKo: "케이블카",
  priceVnd: 500000n,
  options: null,
  vendorId: "v-1",
  vendor: { id: "v-1", userId: "vu-1", approvalStatus: "APPROVED", active: true, user: { zaloUserId: "z-1", locale: "vi" } },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  pricingTotal.value = 500000n;
  tokenFindUnique.mockResolvedValue({
    bookingId: "bk-1",
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
    firstUsedAt: new Date(),
  });
  soCreate.mockResolvedValue({ id: "so-new" });
  bookingFindUnique.mockResolvedValue({ guestName: "대표자", villa: { id: null, name: "Villa A", address: "123" } });
  requireCapability.mockResolvedValue({ ok: true, session: { user: { id: "op-1", role: "ADMIN" } } });
  vendorFindUnique.mockResolvedValue({ approvalStatus: "APPROVED", active: true });
});

// 운영자 라우트 booking 조회는 serviceCatalog 조회와 같은 prisma.booking.findUnique를 쓴다 — 상태 살아있는 예약.
const adminBooking = { id: "bk-1", status: "CONFIRMED", villaId: null };

describe("게스트 POST — TICKET 벤더 가드", () => {
  it("승인·활성 벤더 TICKET → 201(정상 판매)", async () => {
    catalogFindUnique.mockResolvedValue(ticketItem());
    const res = await GUEST_POST(guestReq(ticketBody), GP("tok"));
    expect(res.status).toBe(201);
    expect(soCreate).toHaveBeenCalledOnce();
  });

  it("벤더 미지정 TICKET → 400 TICKET_VENDOR_REQUIRED (판매 차단)", async () => {
    catalogFindUnique.mockResolvedValue(ticketItem({ vendorId: null, vendor: null }));
    const res = await GUEST_POST(guestReq(ticketBody), GP("tok"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_VENDOR_REQUIRED" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("미승인 벤더 TICKET → 400", async () => {
    catalogFindUnique.mockResolvedValue(
      ticketItem({ vendor: { id: "v-1", userId: "vu-1", approvalStatus: "PENDING_APPROVAL", active: true, user: { zaloUserId: null, locale: "vi" } } })
    );
    const res = await GUEST_POST(guestReq(ticketBody), GP("tok"));
    expect(res.status).toBe(400);
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("비활성 벤더 TICKET → 400", async () => {
    catalogFindUnique.mockResolvedValue(
      ticketItem({ vendor: { id: "v-1", userId: "vu-1", approvalStatus: "APPROVED", active: false, user: { zaloUserId: null, locale: "vi" } } })
    );
    const res = await GUEST_POST(guestReq(ticketBody), GP("tok"));
    expect(res.status).toBe(400);
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("무료 TICKET(판매가 0)도 벤더 미지정이면 400 (부분 허용 없음)", async () => {
    pricingTotal.value = 0n;
    catalogFindUnique.mockResolvedValue(ticketItem({ vendorId: null, vendor: null }));
    const res = await GUEST_POST(guestReq(ticketBody), GP("tok"));
    expect(res.status).toBe(400);
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("비TICKET(BBQ) 벤더 미지정 → 201(직접 제공 회귀 불변)", async () => {
    catalogFindUnique.mockResolvedValue(ticketItem({ type: "BBQ", vendorId: null, vendor: null }));
    const res = await GUEST_POST(guestReq({ ...ticketBody, serviceTime: "14:00" }), GP("tok"));
    expect(res.status).toBe(201);
    expect(soCreate).toHaveBeenCalledOnce();
  });
});

describe("운영자 POST — TICKET 벤더 가드 (대칭)", () => {
  beforeEach(() => {
    // 운영자 라우트는 booking.findUnique를 2회 이상 부를 수 있으나, 첫 호출은 예약 상태 확인용.
    bookingFindUnique.mockResolvedValue(adminBooking);
  });

  it("승인·활성 벤더 TICKET → 201", async () => {
    catalogFindUnique.mockResolvedValue(ticketItem());
    vendorFindUnique.mockResolvedValue({ approvalStatus: "APPROVED", active: true });
    const res = await ADMIN_POST(guestReq(ticketBody), AP("bk-1"));
    expect(res.status).toBe(201);
    expect(soCreate).toHaveBeenCalledOnce();
  });

  it("벤더 미지정 TICKET → 400 TICKET_VENDOR_REQUIRED", async () => {
    catalogFindUnique.mockResolvedValue(ticketItem({ vendorId: null, vendor: null }));
    const res = await ADMIN_POST(guestReq(ticketBody), AP("bk-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_VENDOR_REQUIRED" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("미승인 벤더 TICKET → 400", async () => {
    catalogFindUnique.mockResolvedValue(ticketItem());
    vendorFindUnique.mockResolvedValue({ approvalStatus: "PENDING_APPROVAL", active: true });
    const res = await ADMIN_POST(guestReq(ticketBody), AP("bk-1"));
    expect(res.status).toBe(400);
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("비TICKET(BBQ) 벤더 미지정 → 201(직접 제공 회귀 불변)", async () => {
    catalogFindUnique.mockResolvedValue(ticketItem({ type: "BBQ", vendorId: null, vendor: null }));
    const res = await ADMIN_POST(guestReq({ ...ticketBody, serviceTime: "14:00" }), AP("bk-1"));
    expect(res.status).toBe(201);
    expect(soCreate).toHaveBeenCalledOnce();
  });
});
