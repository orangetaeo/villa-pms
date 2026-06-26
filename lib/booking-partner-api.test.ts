import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PUT /api/bookings/[id]/partner — 재지정 시 여신 게이트 재실행 (PARTNER-credit-gate)
 * 차단 파트너 재지정 시 채권 생성 우회를 막는지 검증. auth·prisma·partner-booking mock.
 */
const mockAuth = vi.fn();
const mockBookingFindUnique = vi.fn();
const mockPartnerFindUnique = vi.fn();
const mockBookingUpdate = vi.fn();
const mockEvaluateCredit = vi.fn();
const mockEnsureReceivable = vi.fn();

vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/partner-booking", () => ({
  evaluateConfirmCredit: (...a: unknown[]) => mockEvaluateCredit(...a),
  ensureReceivableForBooking: (...a: unknown[]) => mockEnsureReceivable(...a),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findUnique: (...a: unknown[]) => mockBookingFindUnique(...a) },
    partner: { findUnique: (...a: unknown[]) => mockPartnerFindUnique(...a) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ booking: { update: (...a: unknown[]) => mockBookingUpdate(...a) } }),
  },
}));

import { PUT } from "../app/api/bookings/[id]/partner/route";

const putReq = (body: unknown) =>
  PUT(
    new Request("http://local/api/bookings/b1/partner", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "b1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "owner1", role: "OWNER" } });
  // 확정 예약, 파트너 미연결, 채권 없음
  mockBookingFindUnique.mockResolvedValue({
    id: "b1",
    status: "CONFIRMED",
    partnerId: null,
    receivable: null,
  });
  mockPartnerFindUnique.mockResolvedValue({ id: "p1" });
  mockBookingUpdate.mockResolvedValue({ id: "b1" });
  mockEnsureReceivable.mockResolvedValue({ id: "r1" });
});

describe("PUT /api/bookings/[id]/partner — 재지정 여신 게이트", () => {
  it("차단 파트너(한도초과) 재지정 → 409, 채권 미생성", async () => {
    mockEvaluateCredit.mockResolvedValue({ allowed: false, reason: "OVER_LIMIT" });
    const res = await putReq({ partnerId: "p1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("PARTNER_CREDIT_BLOCKED");
    expect(mockEnsureReceivable).not.toHaveBeenCalled();
  });

  it("정상 파트너 재지정 → 200, 채권 생성", async () => {
    mockEvaluateCredit.mockResolvedValue({ allowed: true, skipped: false });
    const res = await putReq({ partnerId: "p1" });
    expect(res.status).toBe(200);
    expect(mockEnsureReceivable).toHaveBeenCalledOnce();
  });

  it("HOLD(확정 전) 예약 지정 → 게이트·채권 생성 미실행(200)", async () => {
    mockBookingFindUnique.mockResolvedValue({
      id: "b1",
      status: "HOLD",
      partnerId: null,
      receivable: null,
    });
    const res = await putReq({ partnerId: "p1" });
    expect(res.status).toBe(200);
    expect(mockEvaluateCredit).not.toHaveBeenCalled();
    expect(mockEnsureReceivable).not.toHaveBeenCalled();
  });

  it("STAFF → 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "STAFF" } });
    expect((await putReq({ partnerId: "p1" })).status).toBe(403);
  });
});
