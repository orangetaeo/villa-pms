import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PATCH /api/bookings/[id] (note 전용) 라우트 테스트 (T2.5)
 * auth·prisma·audit-log를 mock — 실제 PrismaClient 미생성 (T1.6 패턴)
 */

const mockAuth = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { PATCH } from "../app/api/bookings/[id]/route";

const callPatch = (body: unknown) =>
  PATCH(
    new Request("http://local/api/bookings/bk1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "bk1" }) }
  );

describe("PATCH /api/bookings/[id] — note 전용", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ id: "bk1", note: "이전 메모" });
    mockUpdate.mockResolvedValue({ id: "bk1", note: "새 메모" });
  });

  it("비로그인 → 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await callPatch({ note: "x" });
    expect(res.status).toBe(401);
  });

  it("SUPPLIER → 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SUPPLIER" } });
    const res = await callPatch({ note: "x" });
    expect(res.status).toBe(403);
  });

  it("ADMIN: note 저장 + AuditLog(old/new) 기록", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const res = await callPatch({ note: "새 메모" });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "bk1" },
      data: { note: "새 메모" },
      // T-guest-roster: select에 guestRoster 추가됨 (note·guestRoster 부분 수정 지원)
      select: { id: true, note: true, guestRoster: true },
    });
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin1",
        action: "UPDATE",
        entity: "Booking",
        entityId: "bk1",
        changes: { note: { old: "이전 메모", new: "새 메모" } },
      })
    );
  });

  it("note 외 필드(status 등)는 무시 — 전이 우회 불가", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const res = await callPatch({ note: "메모", status: "CONFIRMED", totalSaleKrw: 1 });
    expect(res.status).toBe(200);
    // update data에 note만 포함
    expect(mockUpdate.mock.calls[0][0].data).toEqual({ note: "메모" });
  });

  it("빈 문자열 → null 저장 (메모 삭제)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    await callPatch({ note: "   " });
    expect(mockUpdate.mock.calls[0][0].data).toEqual({ note: null });
  });

  it("2000자 초과 → 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const res = await callPatch({ note: "가".repeat(2001) });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("note 누락·잘못된 본문 → 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const res = await callPatch({});
    expect(res.status).toBe(400);
  });

  it("미존재 예약 → 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    mockFindUnique.mockResolvedValue(null);
    const res = await callPatch({ note: "x" });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
