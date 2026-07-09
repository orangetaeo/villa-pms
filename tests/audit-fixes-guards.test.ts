import { beforeEach, describe, expect, it, vi } from "vitest";

// T-audit-fixes-2026-07-09 — 전수검사 결함 수정 가드 테스트
//   P2-2: /g 로더가 동의서 서명 전 wifiPassword를 직렬화하지 않는다(서명 후에만).
//   W-2: 통계 매출 쿼리는 seller=OPERATOR 게이트(정본 revenue-ledger와 동일 모수),
//        가동률(점유) 쿼리는 seller 무필터(물리 점유).

const mockToken = { findUnique: vi.fn() };
const mockBooking = { findUnique: vi.fn() };
const emptyList = vi.fn(async (..._a: unknown[]) => []);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: { findUnique: (...a: unknown[]) => mockToken.findUnique(...a) },
    booking: { findUnique: (...a: unknown[]) => mockBooking.findUnique(...a) },
    villaAmenity: { findMany: (...a: unknown[]) => emptyList(...a) },
    minibarItem: { findMany: (...a: unknown[]) => emptyList(...a) },
    villaMinibarStock: { findMany: (...a: unknown[]) => emptyList(...a) },
    serviceCatalogItem: { findMany: (...a: unknown[]) => emptyList(...a) },
    serviceOrder: { findMany: (...a: unknown[]) => emptyList(...a) },
  },
}));
vi.mock("@/lib/pricing", () => ({
  getFxVndPerKrw: vi.fn(async () => null),
}));

import { loadGuestCheckin } from "@/lib/guest-checkin-load";
import {
  resolveStatsPeriod,
  loadOverviewStats,
  loadVillaPerformance,
} from "@/lib/statistics";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const FUTURE = new Date("2026-06-20T00:00:00.000Z");

const bookingRow = {
  id: "b1",
  villaId: "v1",
  checkIn: new Date("2026-06-14T00:00:00.000Z"),
  checkOut: new Date("2026-06-16T00:00:00.000Z"),
  nights: 2,
  guestCount: 2,
  breakfastIncluded: false,
  seller: "OPERATOR",
  partnerId: null,
  saleCurrency: "KRW",
  totalSaleVnd: null,
  totalSaleKrw: 500_000,
  villa: {
    name: "쏘나씨 V11",
    complex: null,
    hasPool: false,
    address: "Phú Quốc",
    wifiSsid: "sonasea-v11",
    wifiPassword: "secret-pw",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockBooking.findUnique.mockResolvedValue(bookingRow);
});

describe("P2-2 — /g 로더 wifiPassword 서명 게이트", () => {
  it("서명 전: wifiPassword=null (wifiSsid는 유지)", async () => {
    mockToken.findUnique.mockResolvedValue({
      bookingId: "b1",
      expiresAt: FUTURE,
      revokedAt: null,
      agreementSignedAt: null,
    });
    const data = await loadGuestCheckin("tok1", NOW);
    expect(data?.alreadySigned).toBe(false);
    expect(data?.booking?.wifiSsid).toBe("sonasea-v11");
    expect(data?.booking?.wifiPassword).toBeNull();
    // RSC payload 전체에 값 자체가 실리지 않아야 한다(클라 게이트가 아니라 서버 게이트)
    expect(JSON.stringify(data)).not.toContain("secret-pw");
  });

  it("서명 후: wifiPassword 노출", async () => {
    mockToken.findUnique.mockResolvedValue({
      bookingId: "b1",
      expiresAt: FUTURE,
      revokedAt: null,
      agreementSignedAt: new Date("2026-06-14T10:00:00.000Z"),
    });
    const data = await loadGuestCheckin("tok1", NOW);
    expect(data?.alreadySigned).toBe(true);
    expect(data?.booking?.wifiPassword).toBe("secret-pw");
  });
});

describe("W-2 — 통계 seller 게이트 (매출=OPERATOR, 점유=무필터)", () => {
  function fakeStatsDb() {
    const bookingFindMany = vi.fn(async (_args: unknown) => []);
    const db = {
      booking: { findMany: bookingFindMany },
      serviceOrder: { findMany: vi.fn(async () => []) },
      checkoutMinibarLine: { findMany: vi.fn(async () => []) },
      villa: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    };
    return { db: db as never, bookingFindMany };
  }

  it("loadOverviewStats 매출 쿼리는 seller=OPERATOR", async () => {
    const { db, bookingFindMany } = fakeStatsDb();
    await loadOverviewStats(resolveStatsPeriod({}, NOW), NOW, db);
    expect(bookingFindMany).toHaveBeenCalledTimes(1);
    const where = (bookingFindMany.mock.calls[0][0] as { where: { seller?: string } }).where;
    expect(where.seller).toBe("OPERATOR");
  });

  it("loadVillaPerformance: 점유 쿼리는 seller 없음, 매출 쿼리는 OPERATOR", async () => {
    const { db, bookingFindMany } = fakeStatsDb();
    await loadVillaPerformance(resolveStatsPeriod({}, NOW), true, NOW, db);
    expect(bookingFindMany).toHaveBeenCalledTimes(2);
    const occWhere = (bookingFindMany.mock.calls[0][0] as { where: { seller?: string } }).where;
    const finWhere = (bookingFindMany.mock.calls[1][0] as { where: { seller?: string } }).where;
    expect(occWhere.seller).toBeUndefined(); // 물리 점유 — 직접판매도 빌라를 점유한다
    expect(finWhere.seller).toBe("OPERATOR");
  });
});
