import { beforeEach, describe, expect, it, vi } from "vitest";

// auth·prisma·audit-log mock (T1.6 패턴). villa-gate는 실제 로직 사용 — 게이트 동작 검증.
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const tx = {
  villa: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  cleaningTask: {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => [] as { id: string; status: string }[]),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
};
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { POST } from "@/app/api/villas/[id]/force-sellable/route";

const postReq = (body?: unknown) =>
  POST(
    new Request("http://local/api/villas/v1/force-sellable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );

const ADMIN = { user: { id: "admin1", role: "ADMIN" } };

beforeEach(() => {
  vi.clearAllMocks();
  // 기본: ACTIVE + 게이트 닫힘 + 미결 검수 0건 + CHECKOUT 0건
  tx.villa.findUnique.mockResolvedValue({ id: "v1", status: "ACTIVE", isSellable: false });
  tx.cleaningTask.count.mockResolvedValue(0);
  tx.cleaningTask.findMany.mockResolvedValue([]);
  tx.cleaningTask.updateMany.mockResolvedValue({ count: 0 });
});

describe("POST /api/villas/[id]/force-sellable — 권한", () => {
  it("비로그인 401 + DB 미접근", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await postReq({ reason: "직접 검수 완료" })).status).toBe(401);
    expect(tx.villa.findUnique).not.toHaveBeenCalled();
  });

  it("SUPPLIER 403 + DB 미접근", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await postReq({ reason: "x" })).status).toBe(403);
    expect(tx.villa.findUnique).not.toHaveBeenCalled();
  });

  it("CLEANER 403 + DB 미접근", async () => {
    mockAuth.mockResolvedValue({ user: { id: "c1", role: "CLEANER" } });
    expect((await postReq({ reason: "x" })).status).toBe(403);
    expect(tx.villa.findUnique).not.toHaveBeenCalled();
  });
});

describe("POST /api/villas/[id]/force-sellable — 상태 가드", () => {
  beforeEach(() => mockAuth.mockResolvedValue(ADMIN));

  it("미존재 빌라 404", async () => {
    tx.villa.findUnique.mockResolvedValue(null);
    const res = await postReq({ reason: "x" });
    expect(res.status).toBe(404);
    expect(tx.villa.update).not.toHaveBeenCalled();
  });

  it("PENDING_REVIEW 409 (INVALID_STATUS + current)", async () => {
    tx.villa.findUnique.mockResolvedValue({ id: "v1", status: "PENDING_REVIEW", isSellable: false });
    const res = await postReq({ reason: "x" });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("INVALID_STATUS");
    expect(json.current).toBe("PENDING_REVIEW");
    expect(tx.villa.update).not.toHaveBeenCalled();
  });

  it("INACTIVE 409", async () => {
    tx.villa.findUnique.mockResolvedValue({ id: "v1", status: "INACTIVE", isSellable: false });
    const res = await postReq({ reason: "x" });
    expect(res.status).toBe(409);
    expect((await res.json()).current).toBe("INACTIVE");
    expect(tx.villa.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/villas/[id]/force-sellable — 성공·게이트 동작", () => {
  beforeEach(() => mockAuth.mockResolvedValue(ADMIN));

  it("성공: isSellable false→true + 응답에 마진/판매가/원가 미포함", async () => {
    const res = await postReq({ reason: "테오 팀 직접 검수" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ id: "v1", isSellable: true, gateAlreadyOpen: false });
    expect(tx.villa.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v1" }, data: { isSellable: true } })
    );
    expect(JSON.stringify(json)).not.toMatch(/margin|salePrice|krw|cost|supplierCost/i);
  });

  it("미결 PERIODIC 검수 태스크 APPROVED 정리 + CHECKOUT 미정리", async () => {
    tx.cleaningTask.findMany.mockResolvedValue([
      { id: "t1", status: "PENDING" },
      { id: "t2", status: "PHOTOS_SUBMITTED" },
    ]);
    const res = await postReq({ reason: "직접 온보딩" });
    expect(res.status).toBe(200);
    expect((await res.json()).resolvedTaskCount).toBe(2);

    // 정리 쿼리는 PERIODIC·bookingId=null·미결 상태만 조회
    expect(tx.cleaningTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          villaId: "v1",
          type: "PERIODIC",
          bookingId: null,
          status: { in: ["PENDING", "PHOTOS_SUBMITTED", "REJECTED"] },
        }),
      })
    );
    // 조회된 태스크만 APPROVED로 정리
    expect(tx.cleaningTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["t1", "t2"] } },
        data: expect.objectContaining({
          status: "APPROVED",
          approvedBy: "admin1",
          rejectNote: "강제 판매가능 — 검수 생략",
        }),
      })
    );
    // CHECKOUT 정리 쿼리는 없어야 함 — findMany는 type:PERIODIC 한정
    const findManyTypes = tx.cleaningTask.findMany.mock.calls.map(
      (c) => ((c as unknown[])[0] as { where: { type?: string } }).where.type
    );
    expect(findManyTypes).not.toContain("CHECKOUT");
  });

  it("멱등: 이미 isSellable=true면 no-op(에러 아님) + 변경/로그 없음", async () => {
    tx.villa.findUnique.mockResolvedValue({ id: "v1", status: "ACTIVE", isSellable: true });
    const res = await postReq({ reason: "재시도" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.gateAlreadyOpen).toBe(true);
    expect(json.resolvedTaskCount).toBe(0);
    expect(tx.villa.update).not.toHaveBeenCalled();
    expect(tx.cleaningTask.updateMany).not.toHaveBeenCalled();
    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });

  it("AuditLog: Villa FORCED_OPEN + reason + resolvedInspectionTasks", async () => {
    tx.cleaningTask.findMany.mockResolvedValue([{ id: "t1", status: "REJECTED" }]);
    await postReq({ reason: "테오 직접 검수 완료" });

    const villaLog = vi
      .mocked(writeAuditLog)
      .mock.calls.map((c) => c[0])
      .find((a) => a.entity === "Villa");
    expect(villaLog).toBeDefined();
    expect(villaLog!.action).toBe("UPDATE");
    expect(villaLog!.changes).toMatchObject({
      isSellableGate: { old: "CLOSED", new: "FORCED_OPEN" },
      reason: { new: "테오 직접 검수 완료" },
      resolvedInspectionTasks: { new: 1 },
    });
    // 정리한 CleaningTask도 각각 감사 로그
    const taskLog = vi
      .mocked(writeAuditLog)
      .mock.calls.map((c) => c[0])
      .find((a) => a.entity === "CleaningTask");
    expect(taskLog).toBeDefined();
    expect(taskLog!.changes).toMatchObject({
      status: { old: "REJECTED", new: "APPROVED" },
    });
  });

  it("기본 사유: reason 미전달 시 '관리자 강제 승인' 기록", async () => {
    await postReq(undefined);
    const villaLog = vi
      .mocked(writeAuditLog)
      .mock.calls.map((c) => c[0])
      .find((a) => a.entity === "Villa");
    expect(villaLog!.changes!.reason).toEqual({ new: "관리자 강제 승인" });
  });

  it("미결 CHECKOUT 경고 플래그 — 응답·AuditLog에 openCheckoutWarning", async () => {
    tx.cleaningTask.count.mockResolvedValue(1); // 미결 CHECKOUT 존재
    const res = await postReq({ reason: "강제 개방" });
    expect(res.status).toBe(200);
    expect((await res.json()).openCheckoutWarning).toBe(true);

    const villaLog = vi
      .mocked(writeAuditLog)
      .mock.calls.map((c) => c[0])
      .find((a) => a.entity === "Villa");
    expect(villaLog!.changes!.openCheckoutWarning).toEqual({ new: true });
  });
});
