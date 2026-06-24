import { beforeEach, describe, expect, it, vi } from "vitest";

// T-guest-roster — PATCH /api/bookings/[id] 가 note·guestRoster 를 부분 수정하고,
// 상태·금액 등 전이 필드는 절대 건드리지 않음(strip)을 검증. 권한·AuditLog 포함.
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));

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

import { PATCH } from "@/app/api/bookings/[id]/route";

const req = (body: unknown) =>
  PATCH(
    new Request("http://local/api/bookings/b1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "b1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockBooking.findUnique.mockResolvedValue({ id: "b1", note: "기존 메모", guestRoster: null });
  mockBooking.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "b1",
    note: "note" in data ? data.note : "기존 메모",
    guestRoster: "guestRoster" in data ? data.guestRoster : null,
  }));
  mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
});

describe("권한", () => {
  it("비로그인 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await req({ guestRoster: "김학태" })).status).toBe(401);
    expect(mockBooking.update).not.toHaveBeenCalled();
  });

  it("SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await req({ guestRoster: "김학태" })).status).toBe(403);
    expect(mockBooking.update).not.toHaveBeenCalled();
  });

  it("CLEANER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "c1", role: "CLEANER" } });
    expect((await req({ guestRoster: "김학태" })).status).toBe(403);
  });
});

describe("부분 수정 — note·guestRoster", () => {
  it("guestRoster만 제공 시 그 필드만 update + AuditLog", async () => {
    const res = await req({ guestRoster: "김학태 / 이영희" });
    expect(res.status).toBe(200);
    const data = mockBooking.update.mock.calls[0][0].data;
    expect(data).toEqual({ guestRoster: "김학태 / 이영희" });
    expect("note" in data).toBe(false);
    const changes = (mockWriteAuditLog.mock.calls[0][0] as { changes: unknown }).changes;
    expect(changes).toEqual({ guestRoster: { old: null, new: "김학태 / 이영희" } });
  });

  it("note만 제공 시 guestRoster 미변경", async () => {
    const res = await req({ note: "특이사항" });
    expect(res.status).toBe(200);
    const data = mockBooking.update.mock.calls[0][0].data;
    expect(data).toEqual({ note: "특이사항" });
    expect("guestRoster" in data).toBe(false);
  });

  it("둘 다 제공 시 둘 다 update", async () => {
    await req({ note: "메모", guestRoster: "김학태" });
    const data = mockBooking.update.mock.calls[0][0].data;
    expect(data).toEqual({ note: "메모", guestRoster: "김학태" });
  });

  it("빈 문자열 guestRoster 는 null 로 저장(삭제)", async () => {
    await req({ guestRoster: "   " });
    const data = mockBooking.update.mock.calls[0][0].data;
    expect(data.guestRoster).toBeNull();
  });

  it("note·guestRoster 둘 다 없으면 400 (update 미호출)", async () => {
    expect((await req({})).status).toBe(400);
    expect(mockBooking.update).not.toHaveBeenCalled();
  });
});

describe("전이 무결성 — 상태·금액 필드 주입 차단", () => {
  it("status·totalSaleKrw 주입은 strip 되어 update data 에 없음", async () => {
    const res = await req({
      guestRoster: "김학태",
      status: "CANCELLED",
      totalSaleKrw: 999999,
      supplierCostVnd: 1,
    });
    expect(res.status).toBe(200);
    const data = mockBooking.update.mock.calls[0][0].data;
    expect(data).toEqual({ guestRoster: "김학태" });
    expect("status" in data).toBe(false);
    expect("totalSaleKrw" in data).toBe(false);
    expect("supplierCostVnd" in data).toBe(false);
  });
});

describe("존재하지 않는 예약", () => {
  it("findUnique null → 404", async () => {
    mockBooking.findUnique.mockResolvedValue(null);
    expect((await req({ guestRoster: "김학태" })).status).toBe(404);
    expect(mockBooking.update).not.toHaveBeenCalled();
  });
});
