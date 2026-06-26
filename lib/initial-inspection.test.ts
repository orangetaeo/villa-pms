import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T3.4b 초기 검수 게이트 테스트 — createInitialInspectionTask + APPROVE 라우트 통합
 */

vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));

// 라우트가 쓰는 전역 prisma — $transaction이 fake tx로 위임
const fakeTx = {
  villa: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(), // T1.2b: PATCH가 update→updateMany 가드로 전환
  },
  cleaningTask: {
    count: vi.fn(),
    create: vi.fn(),
  },
  notification: {
    create: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
  },
}));

import { createInitialInspectionTask } from "@/lib/cleaning";
import { writeAuditLog } from "@/lib/audit-log";
import { PATCH } from "../app/api/villas/[id]/route";
import type { DbClient } from "@/lib/availability";

const NOW = new Date("2026-06-11T10:00:00.000Z");

function resetFakes(opts: { existingTaskCount?: number; villaStatus?: string }) {
  vi.clearAllMocks();
  fakeTx.villa.findUnique.mockResolvedValue({
    id: "v1",
    status: opts.villaStatus ?? "PENDING_REVIEW",
    supplierId: "sup1",
    name: "쏘나씨 V12",
  });
  fakeTx.villa.update.mockResolvedValue({ id: "v1", status: "ACTIVE" });
  fakeTx.villa.updateMany.mockResolvedValue({ count: 1 }); // 가드 전이 성공
  fakeTx.cleaningTask.count.mockResolvedValue(opts.existingTaskCount ?? 0);
  fakeTx.cleaningTask.create.mockResolvedValue({ id: "ct1", villaId: "v1" });
  fakeTx.notification.create.mockResolvedValue({ id: "n1" });
}

describe("createInitialInspectionTask (ADR-0006)", () => {
  beforeEach(() => resetFakes({}));

  it("검수 이력 0건 빌라 → PERIODIC PENDING 태스크 + 공급자 알림 + AuditLog", async () => {
    const task = await createInitialInspectionTask(fakeTx as unknown as DbClient, {
      villaId: "v1",
      actorUserId: "admin1",
      now: NOW,
    });
    expect(task).not.toBeNull();
    expect(fakeTx.cleaningTask.create).toHaveBeenCalledWith({
      data: { villaId: "v1", type: "PERIODIC", status: "PENDING" },
    });
    const notif = fakeTx.notification.create.mock.calls[0][0].data;
    expect(notif.userId).toBe("sup1"); // 공급자에게 (CLEANER 미배정 운영 방식)
    expect(notif.type).toBe("CLEANING_REQUEST");
    expect(notif.payload.initialInspection).toBe(true);
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "CleaningTask", action: "CREATE" })
    );
  });

  it("멱등: 기존 CleaningTask 있으면 미생성(null)", async () => {
    resetFakes({ existingTaskCount: 2 });
    const task = await createInitialInspectionTask(fakeTx as unknown as DbClient, {
      villaId: "v1",
      actorUserId: "admin1",
      now: NOW,
    });
    expect(task).toBeNull();
    expect(fakeTx.cleaningTask.create).not.toHaveBeenCalled();
    expect(fakeTx.notification.create).not.toHaveBeenCalled();
  });

  it("isSellable을 직접 변경하지 않는다 — 게이트 setter 단일 유지", async () => {
    await createInitialInspectionTask(fakeTx as unknown as DbClient, {
      villaId: "v1",
      actorUserId: "admin1",
      now: NOW,
    });
    // villa.update 자체가 호출되지 않음 (게이트는 approveCleaningTask 전용)
    expect(fakeTx.villa.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/villas/[id] — 초기 검수 통합", () => {
  const call = (action: string) =>
    PATCH(
      new Request("http://local/api/villas/v1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }),
      { params: Promise.resolve({ id: "v1" }) }
    );

  it("APPROVE(PENDING_REVIEW→ACTIVE) → 초기 검수 생성 + 응답 플래그", async () => {
    resetFakes({ villaStatus: "PENDING_REVIEW", existingTaskCount: 0 });
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const res = await call("APPROVE");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.initialInspectionCreated).toBe(true);
    expect(fakeTx.cleaningTask.create).toHaveBeenCalled();
  });

  it("APPROVE인데 검수 이력 존재 → 미생성, 플래그 false (멱등)", async () => {
    resetFakes({ villaStatus: "PENDING_REVIEW", existingTaskCount: 1 });
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const res = await call("APPROVE");
    expect(res.status).toBe(200);
    expect((await res.json()).initialInspectionCreated).toBe(false);
  });

  it("REACTIVATE(INACTIVE→ACTIVE)는 초기 검수 미생성", async () => {
    resetFakes({ villaStatus: "INACTIVE", existingTaskCount: 0 });
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const res = await call("REACTIVATE");
    expect(res.status).toBe(200);
    expect((await res.json()).initialInspectionCreated).toBe(false);
    expect(fakeTx.cleaningTask.create).not.toHaveBeenCalled();
  });

  it("권한 회귀: 비로그인 401 / SUPPLIER 403", async () => {
    resetFakes({});
    mockAuth.mockResolvedValue(null);
    expect((await call("APPROVE")).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await call("APPROVE")).status).toBe(403);
  });
});

// ===================== 게이트 개방 E2E (QA 반려 핵심 — ADR-0006 v2) =====================

import { approveCleaningTask } from "@/lib/cleaning";
import type { PrismaClient } from "@prisma/client";

interface GateFakeOpts {
  taskType: "PERIODIC" | "CHECKOUT";
  /** 이번 건 제외 기존 APPROVED 수 */
  priorApprovedCount: number;
  /** 미결 CHECKOUT 수 (이번 건 제외) */
  openCheckoutCount: number;
}

function makeGateFake(opts: GateFakeOpts) {
  const villaUpdate = vi.fn();
  const tx = {
    cleaningTask: {
      findUnique: vi.fn(async () => ({
        id: "task1",
        status: "PHOTOS_SUBMITTED",
        type: opts.taskType,
        villaId: "v1",
        assigneeId: null,
        villa: { supplierId: "sup1", name: "쏘나씨 V12" },
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      // count 호출 순서: (PERIODIC일 때) ① APPROVED 수 → ② 미결 CHECKOUT / (CHECKOUT일 때) ① 미결 CHECKOUT
      count: vi.fn(),
      // v2 품질점수 재계산(recomputeVillaQualityScore)이 호출 — 빈 목록이면 점수 100 조기반환(게이트 테스트는 점수 무관)
      findMany: vi.fn(async () => []),
      findUniqueOrThrow: vi.fn(async () => ({ id: "task1", status: "APPROVED" })),
    },
    auditLog: { count: vi.fn(async () => 0) },
    villa: { update: villaUpdate },
    notification: { create: vi.fn(async () => ({ id: "n1" })) },
  };
  // count 는 이제 게이트 판정에서만 소비(품질점수는 findMany/auditLog 경로). 기본값 0
  tx.cleaningTask.count.mockResolvedValue(0);
  if (opts.taskType === "CHECKOUT") {
    tx.cleaningTask.count.mockResolvedValueOnce(opts.openCheckoutCount);
  } else {
    tx.cleaningTask.count
      .mockResolvedValueOnce(opts.priorApprovedCount)
      .mockResolvedValueOnce(opts.openCheckoutCount);
  }
  const prisma = {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  return { prisma, tx, villaUpdate };
}

describe("approveCleaningTask 게이트 개방 — ADR-0006 v2", () => {
  beforeEach(() => vi.clearAllMocks());

  it("초기 검수(PERIODIC, 첫 APPROVED) 승인 → gateOpened=true + isSellable=true", async () => {
    const { prisma, villaUpdate } = makeGateFake({
      taskType: "PERIODIC",
      priorApprovedCount: 0,
      openCheckoutCount: 0,
    });
    const { gateOpened } = await approveCleaningTask(prisma, {
      taskId: "task1",
      actorUserId: "admin1",
      now: NOW,
    });
    expect(gateOpened).toBe(true);
    expect(villaUpdate).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { isSellable: true },
    });
  });

  it("검수 이력(APPROVED) 있는 빌라의 월간 PERIODIC 승인 → 게이트 불변", async () => {
    const { prisma, villaUpdate } = makeGateFake({
      taskType: "PERIODIC",
      priorApprovedCount: 1,
      openCheckoutCount: 0,
    });
    const { gateOpened } = await approveCleaningTask(prisma, {
      taskId: "task1",
      actorUserId: "admin1",
      now: NOW,
    });
    expect(gateOpened).toBe(false);
    // 게이트 미개방 확인 — isSellable 업데이트는 없어야(품질점수 update는 별개로 허용)
    expect(villaUpdate).not.toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { isSellable: true },
    });
  });

  it("미결 CHECKOUT 존재 시 첫 APPROVED여도 게이트 미개방 (체크아웃 게이트 우회 차단)", async () => {
    const { prisma, villaUpdate } = makeGateFake({
      taskType: "PERIODIC",
      priorApprovedCount: 0,
      openCheckoutCount: 1,
    });
    const { gateOpened } = await approveCleaningTask(prisma, {
      taskId: "task1",
      actorUserId: "admin1",
      now: NOW,
    });
    expect(gateOpened).toBe(false);
    // 게이트 미개방 확인 — isSellable 업데이트는 없어야(품질점수 update는 별개로 허용)
    expect(villaUpdate).not.toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { isSellable: true },
    });
  });

  it("CHECKOUT 승인 경로 회귀 — 미결 0건이면 개방 (T3.4 기존 동작 유지)", async () => {
    const { prisma, villaUpdate } = makeGateFake({
      taskType: "CHECKOUT",
      priorApprovedCount: 99, // CHECKOUT 경로에서는 미사용
      openCheckoutCount: 0,
    });
    const { gateOpened } = await approveCleaningTask(prisma, {
      taskId: "task1",
      actorUserId: "admin1",
      now: NOW,
    });
    expect(gateOpened).toBe(true);
    expect(villaUpdate).toHaveBeenCalled();
  });
});
