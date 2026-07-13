// 운영자(ADMIN) 주문 추가 — TICKET 이용자 스냅샷·시간 미저장·무료 자동 확정 (ADR-0036, 계약 admin-ticket-order-parity)
//   /api/bookings/[id]/service-orders POST — 게스트 라우트와 동일 공유 검증(ticket-order-validation) 재사용.
//   ★ ticket-variant-rules·ticket-guests·ticket-order-validation 실제 구현 사용(검증 로직이 대상).
import { describe, it, expect, vi, beforeEach } from "vitest";

const bookingFindUnique = vi.fn();
const catalogFindUnique = vi.fn();
const soCreate = vi.fn();
const checkInFindUnique = vi.fn();
const guestTokenFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findUnique: (...a: unknown[]) => bookingFindUnique(...a) },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
    serviceOrder: { create: (...a: unknown[]) => soCreate(...a) },
    checkInRecord: { findUnique: (...a: unknown[]) => checkInFindUnique(...a) },
    // 명단 로더(loadCheckinRoster)가 토큰 잠정본도 병렬 조회(ADR-0043) — 확정본 우선이라 여기선 null(폴백 없음).
    guestCheckinToken: { findUnique: (...a: unknown[]) => guestTokenFindUnique(...a) },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

// auth는 GET 핸들러가 import — next-auth 로딩 회피(POST는 requireCapability만 사용).
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));

// 운영자 인증 통과(requireCapability) — session.user.id 주입.
vi.mock("@/lib/api-guard", () => ({
  requireCapability: vi.fn(async () => ({ ok: true, session: { user: { id: "admin-1" } } })),
}));

// parseCatalogOptions는 테스트별로 variants 규칙 주입 가능(기본 빈 옵션). 가격은 selection.quantity 반영.
const catalogParse = vi.fn(() => ({ variants: [] as unknown[], addons: [], modifiers: [] }));
const pricingTotal = { vnd: 500000n };
vi.mock("@/lib/service-catalog", () => {
  class ServiceSelectionError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    parseCatalogOptions: (...a: unknown[]) => catalogParse(...(a as [])),
    resolveOrderPricing: (_i: unknown, _o: unknown, sel: { quantity: number }) => ({
      totalPriceVnd: pricingTotal.vnd,
      quantity: sel.quantity,
      snapshot: { variants: [] },
    }),
    ServiceSelectionError,
  };
});
vi.mock("@/lib/service-display", () => ({ priceKrwCeil: () => 0 }));
vi.mock("@/lib/pricing", () => ({ getFxVndPerKrw: async () => null }));
vi.mock("@/lib/regional-vendor", () => ({ resolveOrderVendorId: async () => null }));
vi.mock("@/lib/date-vn", () => ({
  parseUtcDateOnly: (s: string) => (s ? new Date("2026-08-01T00:00:00Z") : null),
  toDateOnlyString: () => "2026-08-01",
}));

import { POST as CREATE } from "@/app/api/bookings/[id]/service-orders/route";

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const passportOcr = [
  { surname: "KIM", givenNames: "CHUL SOO", passportNo: "M1", nationality: "KOR", birthDate: "1980-05-03", sex: "M" },
  { surname: "LEE", givenNames: null, passportNo: "M2", nationality: "KOR", birthDate: "1992-01-09", sex: "F" },
];
const ticketItem = {
  id: "ci-1",
  active: true,
  type: "TICKET",
  nameKo: "케이블카",
  priceVnd: 500000n,
  options: null,
  vendorId: null,
};
const base = { catalogItemId: "ci-1", quantity: 1, serviceDate: "2026-08-01" };
const params = { params: Promise.resolve({ id: "bk-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  pricingTotal.vnd = 500000n;
  bookingFindUnique.mockResolvedValue({ id: "bk-1", status: "CHECKED_IN", villaId: "v1" });
  catalogFindUnique.mockResolvedValue(ticketItem);
  checkInFindUnique.mockResolvedValue({ passportOcrJson: passportOcr });
  guestTokenFindUnique.mockResolvedValue({ passportOcrJson: null });
  soCreate.mockResolvedValue({ id: "so-new" });
  catalogParse.mockReturnValue({ variants: [], addons: [], modifiers: [] });
});

describe("ADMIN TICKET 이용자 스냅샷 검증(공유 lib)", () => {
  it("체크인 확정본과 일치하면 저장", async () => {
    const res = await CREATE(
      jsonReq({ ...base, ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }] }),
      params
    );
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.ticketGuests).toEqual([{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }]);
    expect(data.requestedVia).toBe("ADMIN");
  });

  it("명단에 없는 이용자면 400 TICKET_GUEST_MISMATCH", async () => {
    const res = await CREATE(
      jsonReq({ ...base, ticketGuests: [{ name: "HACKER", birthDate: "2000-01-01" }] }),
      params
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUEST_MISMATCH" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("인원 수 ≠ quantity면 400 TICKET_GUEST_COUNT_MISMATCH", async () => {
    const res = await CREATE(
      jsonReq({ ...base, quantity: 2, ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }] }),
      params
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUEST_COUNT_MISMATCH" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("중복 인원이면 400 TICKET_GUEST_DUPLICATE", async () => {
    const res = await CREATE(
      jsonReq({
        ...base,
        quantity: 2,
        ticketGuests: [
          { name: "KIM CHUL SOO", birthDate: "1980-05-03" },
          { name: "KIM CHUL SOO", birthDate: "1980-05-03" },
        ],
      }),
      params
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUEST_DUPLICATE" });
  });

  it("규칙 variant를 명단 없이 POST하면 400 TICKET_GUESTS_REQUIRED", async () => {
    catalogParse.mockReturnValue({
      variants: [
        { key: "senior", labelKo: "노인", priceVnd: "300000", bornBeforeYear: 1985 },
        { key: "adult", labelKo: "성인", priceVnd: "500000" },
      ],
      addons: [],
      modifiers: [],
    });
    const res = await CREATE(jsonReq({ ...base, quantity: 3, variantKey: "senior" }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUESTS_REQUIRED" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("출생년도 규칙 위반이면 400 TICKET_GUEST_RULE_MISMATCH", async () => {
    catalogParse.mockReturnValue({
      variants: [{ key: "senior", labelKo: "노인", priceVnd: "300000", bornBeforeYear: 1985 }],
      addons: [],
      modifiers: [],
    });
    const res = await CREATE(
      jsonReq({ ...base, variantKey: "senior", ticketGuests: [{ name: "LEE", birthDate: "1992-01-09" }] }),
      params
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUEST_RULE_MISMATCH" });
  });
});

describe("ADMIN TICKET 시간 정책 — 이용일만", () => {
  it("TICKET은 serviceTime을 보내도 저장하지 않음(null)", async () => {
    const res = await CREATE(jsonReq({ ...base, serviceTime: "14:00" }), params);
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.serviceTime).toBeNull();
  });

  it("비TICKET은 serviceTime 그대로 저장(현행)", async () => {
    catalogFindUnique.mockResolvedValue({ ...ticketItem, type: "MASSAGE" });
    const res = await CREATE(jsonReq({ ...base, serviceTime: "14:00" }), params);
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.serviceTime).toBe("14:00");
  });
});

describe("ADMIN 무료 TICKET 자동 확정(게스트 준용)", () => {
  it("총액 0 TICKET은 status=CONFIRMED + vendorStatus=VENDOR_ACCEPTED", async () => {
    pricingTotal.vnd = 0n;
    const res = await CREATE(jsonReq({ ...base }), params);
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.status).toBe("CONFIRMED");
    expect(data.vendorStatus).toBe("VENDOR_ACCEPTED");
    expect(data.poSentAt).toBeInstanceOf(Date);
    expect(data.vendorRespondedAt).toBeInstanceOf(Date);
  });

  it("유료 TICKET은 요청 status 유지(기본 REQUESTED)·발주함 미세팅", async () => {
    const res = await CREATE(jsonReq({ ...base }), params);
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.status).toBe("REQUESTED");
    expect(data.vendorStatus).toBeUndefined();
  });
});

describe("ADMIN 비TICKET 현행 유지", () => {
  it("ticketGuests가 와도 비TICKET이면 무시(체크인 조회 안 함)", async () => {
    catalogFindUnique.mockResolvedValue({ ...ticketItem, type: "MASSAGE" });
    const res = await CREATE(
      jsonReq({ ...base, serviceTime: "10:00", ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }] }),
      params
    );
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("ticketGuests");
    expect(checkInFindUnique).not.toHaveBeenCalled();
  });
});
