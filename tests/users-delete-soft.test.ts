import { beforeEach, describe, expect, it, vi } from "vitest";

// 회원 소프트삭제 — DELETE /api/users/[id] 가드 전수 검증
// 핸들러 직접호출 + mock 패턴 (users-create-role.test.ts 참고).
// isSystemAdmin은 실 구현 사용(역할 로직 진짜 검증), auth·prisma·writeAuditLog만 mock.

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

// prisma mock — DELETE는 $transaction(tx) 안에서
//   tx.user.findUnique → tx.booking.findFirst → tx.user.update → tx.zaloConversation.updateMany
const tx = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  booking: { findFirst: vi.fn() },
  zaloConversation: { updateMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { DELETE } from "@/app/api/users/[id]/route";

const ADMIN = { user: { id: "admin-1", role: "ADMIN" } };

const delReq = (id: string) =>
  DELETE(new Request(`http://local/api/users/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: 정상 ADMIN 세션 + 빌라/거래 없는 일반 사용자
  mockAuth.mockResolvedValue(ADMIN);
  tx.user.findUnique.mockResolvedValue({
    id: "u-1",
    role: "SUPPLIER",
    deletedAt: null,
    zaloUserId: "zalo-9",
  });
  tx.booking.findFirst.mockResolvedValue(null);
  tx.user.update.mockResolvedValue({});
  tx.zaloConversation.updateMany.mockResolvedValue({ count: 0 });
});

describe("DELETE /api/users/[id] — 회원 소프트삭제 가드", () => {
  it("비인증 세션 → 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await delReq("u-1");
    expect(res.status).toBe(401);
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });

  it("비관리자(SUPPLIER) → 403 FORBIDDEN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s-1", role: "SUPPLIER" } });
    const res = await delReq("u-1");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });

  it("본인 삭제 시도 → 400 CANNOT_DELETE_SELF (락아웃 방지)", async () => {
    const res = await delReq("admin-1"); // 세션 본인 id
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "CANNOT_DELETE_SELF" });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("없는 사용자 → 404 NOT_FOUND", async () => {
    tx.user.findUnique.mockResolvedValue(null);
    const res = await delReq("ghost");
    expect(res.status).toBe(404);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("이미 삭제된 사용자 → 200 멱등 (update 미호출)", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: "u-1",
      role: "SUPPLIER",
      deletedAt: new Date(),
      zaloUserId: null,
    });
    const res = await delReq("u-1");
    expect(res.status).toBe(200);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("OWNER 삭제 시도 → 403 CANNOT_DELETE_OWNER (최상위 권한 보호)", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: "owner-x",
      role: "OWNER",
      deletedAt: null,
      zaloUserId: null,
    });
    const res = await delReq("owner-x");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "CANNOT_DELETE_OWNER" });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("진행 중 예약·체크인 보유 → 409 HAS_ACTIVE_BOOKINGS (거래 사고 방지)", async () => {
    tx.booking.findFirst.mockResolvedValue({ id: "bk-1" });
    const res = await delReq("u-1");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "HAS_ACTIVE_BOOKINGS" });
    expect(tx.user.update).not.toHaveBeenCalled();
    // 진행 중 거래 판정은 HOLD·CONFIRMED·CHECKED_IN만 대상
    expect(tx.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["HOLD", "CONFIRMED", "CHECKED_IN"] },
        }),
      })
    );
  });

  it("정상 삭제(빌라 보유·진행거래 없음) → 200, 소프트삭제 필드 + Zalo 해제 + 감사로그", async () => {
    const res = await delReq("u-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "u-1", deleted: true });

    // 소프트삭제 — deletedAt 스탬프 + isActive=false + zaloUserId=null (완전삭제 아님)
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-1" },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          isActive: false,
          zaloUserId: null,
        }),
      })
    );
    // 끊긴 대화 userId 분리
    expect(tx.zaloConversation.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-1" },
      data: { userId: null },
    });
    // 감사로그 — 트랜잭션 내 DELETE 기록 (절대규칙)
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-1",
        action: "DELETE",
        entity: "User",
        entityId: "u-1",
        db: tx,
      })
    );
  });
});
