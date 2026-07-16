// 게스트 TICKET 이용자 선택 스냅샷 생성 검증 테스트 (ADR-0036)
//   - 체크인 확정본과 일치 → 저장(ticketGuests)
//   - 명단 불일치 → 400 TICKET_GUEST_MISMATCH(PII 주입 방지)
//   - 수량 불일치 → 400 TICKET_GUEST_COUNT_MISMATCH
//   - 미제공 → ticketGuests 미저장(null)
//   - 비TICKET 품목에 ticketGuests 오면 무시(저장 안 함)
//   ★ ticket-guests 매퍼는 실제 구현 사용(검증 로직이 테스트 대상).
import { describe, it, expect, vi, beforeEach } from "vitest";

const tokenFindUnique = vi.fn();
const tokenUpdate = vi.fn();
const catalogFindUnique = vi.fn();
const soCreate = vi.fn();
const bookingFindUnique = vi.fn();
const checkInFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: {
      findUnique: (...a: unknown[]) => tokenFindUnique(...a),
      update: (...a: unknown[]) => tokenUpdate(...a),
    },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
    serviceOrder: { create: (...a: unknown[]) => soCreate(...a) },
    booking: { findUnique: (...a: unknown[]) => bookingFindUnique(...a) },
    checkInRecord: { findUnique: (...a: unknown[]) => checkInFindUnique(...a) },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));
vi.mock("@/lib/guest-checkin", () => ({ guestTokenState: () => "OK" }));
vi.mock("@/lib/guest-rate-limit", () => ({ guestRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/csrf", () => ({ assertSameOrigin: vi.fn(async () => null) }));
vi.mock("@/lib/consumer-signal-notify", () => ({
  notifyOperatorsServiceOrderRequested: vi.fn(async () => undefined),
}));
const sendVendorPoNotifications = vi.fn(async (..._a: unknown[]) => ({ zaloSent: true }));
vi.mock("@/lib/vendor-dispatch", () => ({
  sendVendorPoNotifications: (...a: unknown[]) => sendVendorPoNotifications(...a),
}));
// parseCatalogOptions는 테스트별로 variants 규칙을 주입할 수 있게 오버라이드 가능한 vi.fn(기본 빈 옵션).
const catalogParse = vi.fn(() => ({ variants: [] as unknown[], addons: [], modifiers: [] }));
vi.mock("@/lib/service-catalog", () => {
  class ServiceSelectionError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    parseCatalogOptions: (...a: unknown[]) => catalogParse(...(a as [])),
    // 수량은 요청 selection.quantity를 그대로 반영(수량 일치 검증 테스트용).
    resolveOrderPricing: (_i: unknown, _o: unknown, sel: { quantity: number }) => ({
      totalPriceVnd: 500000n,
      quantity: sel.quantity,
      snapshot: { variants: [] },
    }),
    ServiceSelectionError,
    parseAudiences: () => ["GUEST"],
  };
});
vi.mock("@/lib/service-display", () => ({ priceKrwCeil: () => 0 }));
vi.mock("@/lib/pricing", () => ({ getFxVndPerKrw: async () => null }));
// 이용일 기준: parseUtcDateOnly는 UTC 자정 Date, toDateOnlyString은 그 날짜 문자열(구분 규칙 나이 판정 기준일).
vi.mock("@/lib/date-vn", () => ({
  parseUtcDateOnly: () => new Date("2026-08-01T00:00:00Z"),
  toDateOnlyString: () => "2026-08-01",
}));

import { POST as CREATE } from "@/app/api/g/[token]/service-orders/route";

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 체크인 확정본 — 2명(KIM CHUL SOO 1980-05-03 · LEE 1992-01-09)
const passportOcr = [
  { surname: "KIM", givenNames: "CHUL SOO", passportNo: "M1", nationality: "KOR", birthDate: "1980-05-03", expiryDate: "2030-01-01", sex: "M" },
  { surname: "LEE", givenNames: null, passportNo: "M2", nationality: "KOR", birthDate: "1992-01-09", expiryDate: "2031-01-01", sex: "F" },
];
const ticketItem = {
  id: "ci-1",
  active: true,
  audiences: null,
  type: "TICKET",
  nameKo: "케이블카",
  priceVnd: 500000n,
  options: null,
  // ★판매가능 벤더 배정(TICKET 판매 요건, 계약 ticket-vendor-required-sale-block) — 미배정이면 판매 자체 차단(400).
  vendorId: "v-1",
  vendor: { id: "v-1", userId: "vu-1", approvalStatus: "APPROVED", active: true, user: { zaloUserId: null, locale: "vi" } },
};
const base = { catalogItemId: "ci-1", quantity: 1, serviceDate: "2026-08-01", serviceTime: "14:00", liabilityConsent: true };

beforeEach(() => {
  vi.clearAllMocks();
  tokenFindUnique.mockResolvedValue({
    bookingId: "bk-1",
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
    firstUsedAt: new Date(),
  });
  soCreate.mockResolvedValue({ id: "so-new" });
  bookingFindUnique.mockResolvedValue({ guestName: "대표자", villa: { name: "Villa A", address: "123 St" } });
  checkInFindUnique.mockResolvedValue({ passportOcrJson: passportOcr });
  catalogFindUnique.mockResolvedValue(ticketItem);
  catalogParse.mockReturnValue({ variants: [], addons: [], modifiers: [] });
});

const params = { params: Promise.resolve({ token: "tok" }) };

describe("TICKET 이용자 선택 스냅샷(ADR-0036)", () => {
  it("체크인 확정본과 일치하면 ticketGuests 저장", async () => {
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }] }),
      params
    );
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.ticketGuests).toEqual([{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }]);
    // Zalo 발주 문구에는 미포함(스냅샷은 인앱만)
    expect(sendVendorPoNotifications).not.toHaveBeenCalledWith(
      expect.objectContaining({ ticketGuests: expect.anything() })
    );
  });

  it("명단에 없는 이용자면 400 TICKET_GUEST_MISMATCH", async () => {
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, ticketGuests: [{ name: "HACKER INJECT", birthDate: "2000-01-01" }] }),
      params
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUEST_MISMATCH" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("선택 인원 수 ≠ quantity면 400 TICKET_GUEST_COUNT_MISMATCH", async () => {
    const res = await CREATE(
      jsonReq({ ...base, quantity: 2, ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }] }),
      params
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUEST_COUNT_MISMATCH" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("미제공이면 ticketGuests 미저장(null 흐름 유지)", async () => {
    const res = await CREATE(jsonReq({ ...base, quantity: 1 }), params);
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("ticketGuests");
    // 체크인 조회조차 하지 않음(제공 안 됨)
    expect(checkInFindUnique).not.toHaveBeenCalled();
  });

  it("비TICKET 품목에 ticketGuests가 와도 무시(저장 안 함)", async () => {
    catalogFindUnique.mockResolvedValue({ ...ticketItem, type: "MASSAGE" });
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }] }),
      params
    );
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("ticketGuests");
    expect(checkInFindUnique).not.toHaveBeenCalled();
  });

  it("null 이름 이용자(성만 있는 OCR)도 정확히 일치하면 저장", async () => {
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, ticketGuests: [{ name: "LEE", birthDate: "1992-01-09" }] }),
      params
    );
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.ticketGuests).toEqual([{ name: "LEE", birthDate: "1992-01-09" }]);
  });
});

describe("TICKET 주문 내 중복 인원·신장 스냅샷(ADR-0036 개정)", () => {
  it("같은 name+birthDate 쌍이 2회면 400 TICKET_GUEST_DUPLICATE", async () => {
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
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("자가신고 신장(heightCm)은 스냅샷에 보존", async () => {
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03", heightCm: 128 }] }),
      params
    );
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.ticketGuests).toEqual([{ name: "KIM CHUL SOO", birthDate: "1980-05-03", heightCm: 128 }]);
  });
});

describe("TICKET 구분(variant) 규칙 서버 재검증(ADR-0036 개정)", () => {
  // 노인(bornBeforeYear=1985) variant를 카탈로그에 심는다. serviceDate=2026-08-01 기준.
  const seniorVariants = [
    { key: "senior", labelKo: "노인", priceVnd: "300000", bornBeforeYear: 1985 },
    { key: "adult", labelKo: "성인", priceVnd: "500000" },
  ];

  it("출생년도 규칙 충족(1980<1985) → 저장 성공", async () => {
    catalogParse.mockReturnValue({ variants: seniorVariants, addons: [], modifiers: [] });
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, variantKey: "senior", ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }] }),
      params
    );
    expect(res.status).toBe(201);
  });

  it("출생년도 규칙 위반(1992≥1985에 senior 제출) → 400 TICKET_GUEST_RULE_MISMATCH", async () => {
    catalogParse.mockReturnValue({ variants: seniorVariants, addons: [], modifiers: [] });
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, variantKey: "senior", ticketGuests: [{ name: "LEE", birthDate: "1992-01-09" }] }),
      params
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUEST_RULE_MISMATCH" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("규칙 없는 기본(성인) variant는 검증 없이 저장", async () => {
    catalogParse.mockReturnValue({ variants: seniorVariants, addons: [], modifiers: [] });
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, variantKey: "adult", ticketGuests: [{ name: "LEE", birthDate: "1992-01-09" }] }),
      params
    );
    expect(res.status).toBe(201);
  });

  it("★가격 조작 우회 차단 — 규칙 variant를 명단 없이 POST하면 400 TICKET_GUESTS_REQUIRED", async () => {
    catalogParse.mockReturnValue({ variants: seniorVariants, addons: [], modifiers: [] });
    // ticketGuests 생략 + 규칙 있는 senior 단가로 3장 — 검증 우회 시 201이 되면 안 됨.
    const res = await CREATE(jsonReq({ ...base, quantity: 3, variantKey: "senior" }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUESTS_REQUIRED" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("규칙 없는 기본 variant는 명단 생략 허용(체크인 전 주문 흐름 보존)", async () => {
    catalogParse.mockReturnValue({ variants: seniorVariants, addons: [], modifiers: [] });
    const res = await CREATE(jsonReq({ ...base, quantity: 2, variantKey: "adult" }), params);
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("ticketGuests");
  });

  it("신장 규칙(heightMaxCm=140) — 신장 미신고면 400", async () => {
    catalogParse.mockReturnValue({
      variants: [{ key: "child", labelKo: "어린이", priceVnd: "200000", heightMaxCm: 140 }],
      addons: [],
      modifiers: [],
    });
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, variantKey: "child", ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03" }] }),
      params
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_GUEST_RULE_MISMATCH" });
  });

  it("신장 규칙 충족(128<140) → 저장 성공, 신장 스냅샷 보존", async () => {
    catalogParse.mockReturnValue({
      variants: [{ key: "child", labelKo: "어린이", priceVnd: "200000", heightMaxCm: 140 }],
      addons: [],
      modifiers: [],
    });
    const res = await CREATE(
      jsonReq({ ...base, quantity: 1, variantKey: "child", ticketGuests: [{ name: "KIM CHUL SOO", birthDate: "1980-05-03", heightCm: 128 }] }),
      params
    );
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.ticketGuests).toEqual([{ name: "KIM CHUL SOO", birthDate: "1980-05-03", heightCm: 128 }]);
  });
});

describe("TICKET 시간 정책 — 이용일만(테오 2026-07-12)", () => {
  const noTime = { catalogItemId: "ci-1", quantity: 1, serviceDate: "2026-08-01", liabilityConsent: true };

  it("TICKET은 serviceTime 미제공이어도 생성 성공(null 저장)", async () => {
    const res = await CREATE(jsonReq(noTime), params);
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.serviceTime).toBeNull();
  });

  it("비TICKET은 serviceTime 미제공이면 400 SERVICE_TIME_REQUIRED", async () => {
    catalogFindUnique.mockResolvedValue({ ...ticketItem, type: "MASSAGE" });
    const res = await CREATE(jsonReq(noTime), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "SERVICE_TIME_REQUIRED" });
    expect(soCreate).not.toHaveBeenCalled();
  });

  it("TICKET에 serviceTime을 보내면 그대로 저장(허용)", async () => {
    const res = await CREATE(jsonReq({ ...base, quantity: 1 }), params); // base엔 14:00 포함
    expect(res.status).toBe(201);
    const data = (soCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.serviceTime).toBe("14:00");
  });
});
