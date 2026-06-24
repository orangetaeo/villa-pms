import { beforeEach, describe, expect, it, vi } from "vitest";

// T-agency-roster-selfinput — POST /api/p/[token]/roster 공개 명단 입력.
// 교차 토큰 차단·rate-limit·상태 가드·guestRoster만 수정(strip)·마진 미노출 검증.
const mockCheckRateLimit = vi.fn((..._a: unknown[]) => ({ allowed: true }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
  clientIp: () => "1.2.3.4",
}));

const mockWriteAuditLog = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/audit-log", () => ({
  writeAuditLog: (...a: unknown[]) => mockWriteAuditLog(...a),
}));

const mockBooking = { findUnique: vi.fn(), update: vi.fn() };
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: (...a: unknown[]) => mockBooking.findUnique(...a),
      update: (...a: unknown[]) => mockBooking.update(...a),
    },
  },
}));

import { POST } from "@/app/api/p/[token]/roster/route";

const req = (token: string, body: unknown) =>
  POST(
    new Request(`http://local/api/p/${token}/roster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockReturnValue({ allowed: true });
  mockBooking.findUnique.mockResolvedValue({
    id: "b1",
    status: "CONFIRMED",
    guestRoster: null,
    proposalItem: { proposal: { token: "tok1" } },
  });
  mockBooking.update.mockResolvedValue({ id: "b1" });
});

describe("교차 토큰·존재", () => {
  it("다른 제안 토큰으로 접근 시 404", async () => {
    const res = await req("WRONG", { bookingId: "b1", guestRoster: "김학태" });
    expect(res.status).toBe(404);
    expect(mockBooking.update).not.toHaveBeenCalled();
  });

  it("예약 없음 404", async () => {
    mockBooking.findUnique.mockResolvedValue(null);
    expect((await req("tok1", { bookingId: "b1", guestRoster: "김학태" })).status).toBe(404);
    expect(mockBooking.update).not.toHaveBeenCalled();
  });
});

describe("rate-limit", () => {
  it("한도 초과 시 429 (update 미호출)", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false });
    expect((await req("tok1", { bookingId: "b1", guestRoster: "김학태" })).status).toBe(429);
    expect(mockBooking.findUnique).not.toHaveBeenCalled();
  });
});

describe("상태 가드 — HOLD·CONFIRMED만", () => {
  it("CHECKED_IN 예약은 409 closed", async () => {
    mockBooking.findUnique.mockResolvedValue({
      id: "b1", status: "CHECKED_IN", guestRoster: null,
      proposalItem: { proposal: { token: "tok1" } },
    });
    expect((await req("tok1", { bookingId: "b1", guestRoster: "김학태" })).status).toBe(409);
    expect(mockBooking.update).not.toHaveBeenCalled();
  });

  it("CANCELLED 예약은 409", async () => {
    mockBooking.findUnique.mockResolvedValue({
      id: "b1", status: "CANCELLED", guestRoster: null,
      proposalItem: { proposal: { token: "tok1" } },
    });
    expect((await req("tok1", { bookingId: "b1", guestRoster: "김학태" })).status).toBe(409);
  });

  it("HOLD 예약은 허용 (200)", async () => {
    mockBooking.findUnique.mockResolvedValue({
      id: "b1", status: "HOLD", guestRoster: null,
      proposalItem: { proposal: { token: "tok1" } },
    });
    expect((await req("tok1", { bookingId: "b1", guestRoster: "김학태" })).status).toBe(200);
  });
});

describe("guestRoster 저장", () => {
  it("정상 저장 + AuditLog(userId null)", async () => {
    const res = await req("tok1", { bookingId: "b1", guestRoster: "김학태 / 이영희" });
    expect(res.status).toBe(200);
    expect(mockBooking.update.mock.calls[0][0].data).toEqual({ guestRoster: "김학태 / 이영희" });
    const audit = mockWriteAuditLog.mock.calls[0][0] as { userId: unknown; changes: unknown };
    expect(audit.userId).toBeNull();
    expect(audit.changes).toEqual({ guestRoster: { old: null, new: "김학태 / 이영희" } });
  });

  it("빈 문자열은 null 저장(삭제)", async () => {
    await req("tok1", { bookingId: "b1", guestRoster: "   " });
    expect(mockBooking.update.mock.calls[0][0].data.guestRoster).toBeNull();
  });

  it("상태·금액 필드 주입은 strip — guestRoster만 update", async () => {
    await req("tok1", {
      bookingId: "b1",
      guestRoster: "김학태",
      status: "CANCELLED",
      totalSaleKrw: 999,
    });
    const data = mockBooking.update.mock.calls[0][0].data;
    expect(data).toEqual({ guestRoster: "김학태" });
    expect("status" in data).toBe(false);
    expect("totalSaleKrw" in data).toBe(false);
  });

  it("bookingId 누락 → 400", async () => {
    expect((await req("tok1", { guestRoster: "김학태" })).status).toBe(400);
  });
});
