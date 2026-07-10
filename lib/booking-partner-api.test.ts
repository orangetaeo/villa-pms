import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PUT /api/bookings/[id]/partner — 재지정 시 여신 게이트 재실행 (PARTNER-credit-gate)
 * 차단 파트너 재지정 시 채권 생성 우회를 막는지 검증. auth·prisma·partner-booking mock.
 */
const mockAuth = vi.fn();
const mockBookingFindUnique = vi.fn();
const mockBookingFreshStatus = vi.fn(); // 트랜잭션 내 상태 재읽기(findUniqueOrThrow)
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
      fn({
        // 채권 락(pg_advisory_xact_lock) — 테스트에선 no-op.
        $executeRaw: async () => 0,
        booking: {
          update: (...a: unknown[]) => mockBookingUpdate(...a),
          // 트랜잭션 내 상태 재읽기 — 바깥 stale 스냅샷과 분리해 경합 시나리오를 검증 가능.
          findUniqueOrThrow: (...a: unknown[]) => mockBookingFreshStatus(...a),
        },
      }),
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
  // 트랜잭션 내 재읽기 기본값 = 바깥과 동일(CONFIRMED). 경합 테스트에서만 다르게 설정.
  mockBookingFreshStatus.mockResolvedValue({ status: "CONFIRMED" });
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
    mockBookingFreshStatus.mockResolvedValue({ status: "HOLD" });
    const res = await putReq({ partnerId: "p1" });
    expect(res.status).toBe(200);
    expect(mockEvaluateCredit).not.toHaveBeenCalled();
    expect(mockEnsureReceivable).not.toHaveBeenCalled();
  });

  it("경합: 바깥 스냅샷 HOLD(stale)지만 트랜잭션 내 상태가 CONFIRMED면 채권 생성", async () => {
    // 동시 confirmHold가 이 PUT의 트랜잭션 직전 커밋 → 바깥 findUnique는 HOLD를 봤으나
    // 락으로 직렬화된 트랜잭션 내 재읽기는 CONFIRMED. stale 스냅샷으로 채권을 건너뛰면 미수 누락 발생.
    mockBookingFindUnique.mockResolvedValue({
      id: "b1",
      status: "HOLD", // stale
      partnerId: null,
      receivable: null,
    });
    mockBookingFreshStatus.mockResolvedValue({ status: "CONFIRMED" }); // 직렬화 후 실제 상태
    mockEvaluateCredit.mockResolvedValue({ allowed: true, skipped: false });
    const res = await putReq({ partnerId: "p1" });
    expect(res.status).toBe(200);
    expect(mockEnsureReceivable).toHaveBeenCalledOnce(); // 채권 생성됨 — 누락 없음
  });

  it("STAFF → 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "STAFF" } });
    expect((await putReq({ partnerId: "p1" })).status).toBe(403);
  });
});
