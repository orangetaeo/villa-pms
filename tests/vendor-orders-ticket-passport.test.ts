// 벤더 발주 목록 GET — TICKET 이용자 스냅샷 부착 테스트 (ADR-0036 개정)
//   ★전체명단 폴백 제거: 벤더 guests = 주문 스냅샷(ticketGuests)만. 체크인 명단 배치조회 없음.
//   - TICKET 행에만 guests 부착(비TICKET 응답 shape 불변)
//   - 화이트리스트: 이름·생년월일·신장만 — passportNo·nationality·sex·expiryDate·bookingId 미노출
//   - 스냅샷 비면(구주문·미선택) guests: [] → 화면은 "이용자 미지정"
//   - 체크인 명단 조회(checkInRecord.findMany)는 절대 호출되지 않음
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

describe("vendor orders — TICKET 이용자 스냅샷(ADR-0036 개정)", () => {
  it("TICKET 행에 guests 부착 — 주문 스냅샷만(이름·생년월일·신장), 그 외 필드·bookingId 미노출", async () => {
    soFindMany.mockResolvedValueOnce([
      {
        ...rowBase,
        id: "so-1",
        ticketGuests: [
          // 저장 스냅샷에 오염 필드가 섞여 들어와도 화이트리스트가 걸러야 함
          { name: "KIM CHUL SOO", birthDate: "1980-05-03", heightCm: 132, passportNo: "M12345678", sex: "M" },
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
    expect(guests[0].heightCm).toBe(132); // 자가신고 신장은 통과
    // ★ 누수: 화이트리스트 외 필드는 절대 미노출
    expect(guests[0]).not.toHaveProperty("passportNo");
    expect(guests[0]).not.toHaveProperty("sex");
    expect(json.orders[0]).not.toHaveProperty("bookingId");
    // ★전체명단 폴백 제거: 체크인 명단 배치 조회는 절대 호출되지 않는다
    expect(checkInFindMany).not.toHaveBeenCalled();
  });

  it("비TICKET 행에는 guests 키 자체가 없음(응답 shape 불변)", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "so-2", type: "MASSAGE" }]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    expect(json.orders[0]).not.toHaveProperty("guests");
    expect(checkInFindMany).not.toHaveBeenCalled();
  });

  it("스냅샷 없음(null) → guests: [] (폴백 없음 — 화면은 '이용자 미지정')", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "so-3", ticketGuests: null }]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    expect(json.orders[0].guests).toEqual([]);
    expect(checkInFindMany).not.toHaveBeenCalled();
  });

  it("스냅샷 빈 배열(구주문·미선택) → guests: [] (전체명단으로 채우지 않음)", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "so-4", ticketGuests: [] }]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<{ guests: unknown }> };
    expect(json.orders[0].guests).toEqual([]);
  });

  it("스냅샷 null 필드 관용 — name null·birthDate null, 신장 없으면 heightCm 키 없음", async () => {
    soFindMany.mockResolvedValueOnce([
      {
        ...rowBase,
        id: "so-5",
        ticketGuests: [
          { name: null, birthDate: null },
          { name: "LEE", birthDate: "1992-01-09" },
        ],
      },
    ]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<{ guests: Array<Record<string, unknown>> }> };
    const guests = json.orders[0].guests;
    expect(guests[0]).toEqual({ name: null, birthDate: null });
    expect(guests[1]).toEqual({ name: "LEE", birthDate: "1992-01-09" });
    expect(guests[1]).not.toHaveProperty("heightCm");
  });

  it("ticketGuests가 배열이 아닌 불량 값 → 빈 배열", async () => {
    soFindMany.mockResolvedValueOnce([{ ...rowBase, id: "so-6", ticketGuests: { not: "an array" } }]);
    const res = await call("tab=inbox");
    const json = (await res.json()) as { orders: Array<Record<string, unknown>> };
    expect(json.orders[0].guests).toEqual([]);
  });
});
