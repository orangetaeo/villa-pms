// 벤더 발주 목록 GET — TICKET 투숙객 여권(이름·생년월일) 부착 테스트 (ADR-0036)
//   - TICKET 행에만 guests 부착(비TICKET 응답 shape 불변)
//   - 화이트리스트: 이름·생년월일만 — passportNo·nationality·sex·expiryDate·bookingId 미노출
//   - 체크인 레코드 없음 → guests: []
//   - OCR 원소 null 필드 관용(name null·birthDate null)
//   - passportOcrJson이 배열 아님(불량) → 빈 배열
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma mock (checkInRecord.findMany 포함) ──
const soCount = vi.fn();
const soFindMany = vi.fn();
const soAggregate = vi.fn();
const catalogFindMany = vi.fn();
const checkInFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceOrder: {
      count: (...a: unknown[]) => soCount(...a),
      findMany: (...a: unknown[]) => soFindMany(...a),
      aggregate: (...a: unknown[]) => soAggregate(...a),
    },
    serviceCatalogItem: { findMany: (...a: unknown[]) => catalogFindMany(...a) },
    checkInRecord: { findMany: (...a: unknown[]) => checkInFindMany(...a) },
  },
}));

const authFn = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => authFn(...a) }));
vi.mock("@/lib/permissions", () => ({ isVendor: (r?: string) => r === "VENDOR" }));

const getVendorIdForUser = vi.fn();
vi.mock("@/lib/vendor-auth", () => ({ getVendorIdForUser: (...a: unknown[]) => getVendorIdForUser(...a) }));

vi.mock("@/lib/locale", () => ({ getSupplierLocale: vi.fn(async () => "vi") }));
vi.mock("@/lib/service-display", () => ({
  pickI18n: () => "item",
  selectedOptionLabels: () => [],
}));
vi.mock("@/lib/villa-name", () => ({ formatVillaName: () => "villa" }));

import { GET } from "@/app/api/vendor/orders/route";

const call = (qs: string) => GET(new Request(`http://local/api/vendor/orders?${qs}`));

// mapRows가 접근하는 최소 필드셋(null 기본). costVnd는 bigint(.toString()).
const rowBase = {
  id: "so-1",
  type: "TICKET",
  status: "REQUESTED",
  vendorStatus: "PENDING_VENDOR",
  serviceDate: null,
  serviceTime: null,
  quantity: 2,
  costVnd: 0n,
  vendorSettledAt: null,
  vendorSettleMethod: null,
  vendorSettleNote: null,
  poSentAt: null,
  vendorRespondedAt: null,
  vendorCompletedAt: null,
  proposedServiceDate: null,
  proposedServiceTime: null,
  vendorProposalNote: null,
  vendorProposalRespondedAt: null,
  vendorProposalOutcome: null,
  createdAt: null,
  catalogItemId: null,
  vendorName: null,
  guestNote: null,
  customerName: null as string | null,
  selectedOptions: null,
  ticketUrls: [],
  bookingId: "bk-1",
  booking: { checkIn: null, checkOut: null, guestCount: 2, guestName: "대표자", villa: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  authFn.mockResolvedValue({ user: { id: "vu-1", role: "VENDOR", locale: "vi" } });
  getVendorIdForUser.mockResolvedValue("vd-1");
  soCount.mockResolvedValue(0);
  soFindMany.mockResolvedValue([]);
  soAggregate.mockResolvedValue({ _sum: { costVnd: null }, _count: 0 });
  catalogFindMany.mockResolvedValue([]);
  checkInFindMany.mockResolvedValue([]);
});

describe("vendor orders — TICKET 투숙객 여권(ADR-0036)", () => {
  it("TICKET 행에 guests 부착 — 이름·생년월일만, 그 외 여권 필드·bookingId 미노출", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "so-1", bookingId: "bk-1" }]);
    checkInFindMany.mockResolvedValueOnce([
      {
        bookingId: "bk-1",
        passportOcrJson: [
          {
            surname: "KIM",
            givenNames: "CHUL SOO",
            passportNo: "M12345678",
            nationality: "KOR",
            birthDate: "1980-05-03",
            expiryDate: "2030-05-03",
            sex: "M",
          },
        ],
      },
    ]);
    const res = await call("tab=inbox");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    const guests = json.orders[0].guests as Array<Record<string, unknown>>;
    expect(guests).toHaveLength(1);
    expect(guests[0].name).toBe("KIM CHUL SOO");
    expect(guests[0].birthDate).toBe("1980-05-03");
    // ★ 누수: 여권번호·국적·성별·만료일 등 화이트리스트 외 필드는 절대 미노출
    expect(guests[0]).not.toHaveProperty("passportNo");
    expect(guests[0]).not.toHaveProperty("nationality");
    expect(guests[0]).not.toHaveProperty("sex");
    expect(guests[0]).not.toHaveProperty("expiryDate");
    expect(guests[0]).not.toHaveProperty("passportPhotoUrls");
    // bookingId는 내부 조인용 — 응답 행에 노출 금지
    expect(json.orders[0]).not.toHaveProperty("bookingId");
  });

  it("비TICKET 행에는 guests 키 자체가 없음(응답 shape 불변)", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "so-2", type: "MASSAGE", bookingId: "bk-1" }]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    expect(json.orders[0]).not.toHaveProperty("guests");
    // 비TICKET는 체크인 조회조차 하지 않음(배치 대상 없음)
    expect(checkInFindMany).not.toHaveBeenCalled();
  });

  it("체크인 레코드 없음 → guests: []", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "so-3", bookingId: "bk-9" }]);
    checkInFindMany.mockResolvedValueOnce([]); // 아직 체크인 전
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    expect(json.orders[0].guests).toEqual([]);
  });

  it("OCR 원소 null 필드 관용 — name null·birthDate null 처리", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "so-4", bookingId: "bk-1" }]);
    checkInFindMany.mockResolvedValueOnce([
      {
        bookingId: "bk-1",
        passportOcrJson: [
          { surname: null, givenNames: null, birthDate: null }, // 전부 null
          { surname: "LEE", givenNames: null, birthDate: "1992-01-09" }, // 성만
        ],
      },
    ]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<{ guests: Array<Record<string, unknown>> }> };
    const guests = json.orders[0].guests;
    expect(guests[0]).toEqual({ name: null, birthDate: null });
    expect(guests[1]).toEqual({ name: "LEE", birthDate: "1992-01-09" });
  });

  it("passportOcrJson이 배열이 아닌 불량 값 → 빈 배열", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "so-5", bookingId: "bk-1" }]);
    checkInFindMany.mockResolvedValueOnce([{ bookingId: "bk-1", passportOcrJson: { not: "an array" } }]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    expect(json.orders[0].guests).toEqual([]);
  });

  it("주문 스냅샷(ticketGuests) 우선 — 체크인 전체 명단보다 선택분이 우선", async () => {
    soFindMany.mockResolvedValueOnce([
      {
        ...rowBase,
        id: "so-6",
        bookingId: "bk-1",
        // 소비자가 고른 1명 스냅샷(이미 {name, birthDate})
        ticketGuests: [{ name: "SNAP ONE", birthDate: "1990-01-01" }],
      },
    ]);
    // 체크인엔 2명이 있으나 스냅샷이 있으므로 폴백되지 않아야 함
    checkInFindMany.mockResolvedValueOnce([
      {
        bookingId: "bk-1",
        passportOcrJson: [
          { surname: "A", givenNames: "AA", birthDate: "1980-01-01" },
          { surname: "B", givenNames: "BB", birthDate: "1981-02-02" },
        ],
      },
    ]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<{ guests: unknown }> };
    expect(json.orders[0].guests).toEqual([{ name: "SNAP ONE", birthDate: "1990-01-01" }]);
  });

  it("스냅샷 비면 체크인 전체 명단 폴백(구주문·미선택)", async () => {
    soFindMany.mockResolvedValueOnce([
      { ...rowBase, id: "so-7", bookingId: "bk-1", ticketGuests: [] },
    ]);
    checkInFindMany.mockResolvedValueOnce([
      { bookingId: "bk-1", passportOcrJson: [{ surname: "A", givenNames: "AA", birthDate: "1980-01-01" }] },
    ]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<{ guests: unknown }> };
    expect(json.orders[0].guests).toEqual([{ name: "A AA", birthDate: "1980-01-01" }]);
  });
});
