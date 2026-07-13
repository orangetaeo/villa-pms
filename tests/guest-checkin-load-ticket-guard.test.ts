// 게스트 체크인 로더 — TICKET 방어심층(P3-⑤) + 취소 티켓 QR 차단(항목 7)
//   - P3-⑤: TICKET 주문은 확정·수락이어도 vendorName/vendorPhone을 payload에 싣지 않는다(티켓 문의 본사 일원화).
//   - 항목 7: status=CANCELLED 주문의 ticketUrls를 빈 배열로 절단(원본 DB는 보존, 로더에서만 차단).
//   - 비TICKET·비취소 주문은 불변(회귀 방지).
import { describe, it, expect, vi, beforeEach } from "vitest";

const tokenFindUnique = vi.fn();
const bookingFindUnique = vi.fn();
const amenityFindMany = vi.fn();
const minibarFindMany = vi.fn();
const stockFindMany = vi.fn();
const catalogFindMany = vi.fn();
const soFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: { findUnique: (...a: unknown[]) => tokenFindUnique(...a) },
    booking: { findUnique: (...a: unknown[]) => bookingFindUnique(...a) },
    villaAmenity: { findMany: (...a: unknown[]) => amenityFindMany(...a) },
    minibarItem: { findMany: (...a: unknown[]) => minibarFindMany(...a) },
    villaMinibarStock: { findMany: (...a: unknown[]) => stockFindMany(...a) },
    serviceCatalogItem: { findMany: (...a: unknown[]) => catalogFindMany(...a) },
    serviceOrder: { findMany: (...a: unknown[]) => soFindMany(...a) },
  },
}));

vi.mock("@/lib/guest-checkin", () => ({ guestTokenState: () => "OK" }));
vi.mock("@/lib/agreement", () => ({
  AGREEMENT_VERSION: "1",
  AGREEMENT_DOC_TITLE: { ko: "동의서", en: "", ru: "", zh: "", vi: "" },
  AGREEMENT_CLAUSES: {},
  buildClauseOrder: () => [],
}));
vi.mock("@/lib/minibar-inventory", () => ({ effectivePar: (a: number | undefined, b: number) => a ?? b }));
vi.mock("@/lib/service-catalog", () => ({
  stripOptionCosts: (o: unknown) => o,
  parseSelectedOptions: () => [],
  parseAudiences: () => ["GUEST"],
}));
vi.mock("@/lib/pricing", () => ({ getFxVndPerKrw: async () => null }));

import { loadGuestCheckin } from "@/lib/guest-checkin-load";

const orderBase = {
  id: "o-1",
  type: "MASSAGE",
  catalogItemId: null,
  status: "CONFIRMED",
  quantity: 1,
  priceKrw: null,
  priceVnd: null,
  vendorStatus: "VENDOR_ACCEPTED",
  poSentAt: new Date(),
  serviceDate: null,
  serviceTime: null,
  selectedOptions: null,
  proposedServiceDate: null,
  proposedServiceTime: null,
  vendorProposalNote: null,
  vendorProposalRespondedAt: null,
  ticketUrls: [] as string[],
  ticketGuests: null,
  vendor: { name: "권씨 마사지", phone: "0900000001" },
};

beforeEach(() => {
  vi.clearAllMocks();
  tokenFindUnique.mockResolvedValue({
    bookingId: "bk-1",
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    agreementSignedAt: new Date(),
    passportPhotoUrls: [],
  });
  bookingFindUnique.mockResolvedValue({
    id: "bk-1",
    status: "CONFIRMED",
    villaId: "vl-1",
    checkIn: new Date("2026-08-01"),
    checkOut: new Date("2026-08-03"),
    nights: 2,
    guestCount: 2,
    breakfastIncluded: false,
    seller: "OPERATOR",
    partnerId: null,
    saleCurrency: "KRW",
    totalSaleVnd: null,
    totalSaleKrw: 100000,
    villa: { name: "Villa A", complex: null, hasPool: false, address: null, wifiSsid: null, wifiPassword: null },
  });
  amenityFindMany.mockResolvedValue([]);
  minibarFindMany.mockResolvedValue([]);
  stockFindMany.mockResolvedValue([]);
  catalogFindMany.mockResolvedValue([]);
  soFindMany.mockResolvedValue([]);
});

const load = () => loadGuestCheckin("tok-1");

describe("로더 TICKET 연락처 방어심층 (P3-⑤)", () => {
  it("비TICKET 확정 주문 → vendorName/phone 노출(불변)", async () => {
    soFindMany.mockResolvedValue([{ ...orderBase, type: "MASSAGE" }]);
    const data = await load();
    const o = data!.requestedOrders[0];
    expect(o.vendorName).toBe("권씨 마사지");
    expect(o.vendorPhone).toBe("0900000001");
  });

  it("TICKET 확정·수락 주문 → vendorName/phone null(연락처 미포함)", async () => {
    soFindMany.mockResolvedValue([{ ...orderBase, type: "TICKET", status: "CONFIRMED" }]);
    const data = await load();
    const o = data!.requestedOrders[0];
    expect(o.vendorName).toBeNull();
    expect(o.vendorPhone).toBeNull();
  });
});

describe("취소 티켓 QR 소비자 차단 (항목 7)", () => {
  it("CANCELLED 주문 → ticketUrls 빈 배열(원본 보존은 DB 계층)", async () => {
    soFindMany.mockResolvedValue([
      { ...orderBase, type: "TICKET", status: "CANCELLED", ticketUrls: ["/u/a.jpg", "/u/b.jpg"] },
    ]);
    const data = await load();
    expect(data!.requestedOrders[0].ticketUrls).toEqual([]);
  });

  it("비취소 TICKET 주문 → ticketUrls 유지(회귀 방지)", async () => {
    soFindMany.mockResolvedValue([
      { ...orderBase, type: "TICKET", status: "CONFIRMED", ticketUrls: ["/u/a.jpg", "/u/b.jpg"] },
    ]);
    const data = await load();
    expect(data!.requestedOrders[0].ticketUrls).toEqual(["/u/a.jpg", "/u/b.jpg"]);
  });
});
