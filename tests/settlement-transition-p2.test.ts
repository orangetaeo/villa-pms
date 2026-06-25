import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettlementStatus } from "@prisma/client";

// 정산 2차 P2-2 — transitionSettlement 생애주기 전이 + 환차/타임스탬프 영속 검증.
// db는 인자로 주입 가능하므로 mock 객체를 직접 넘긴다(prisma mock 불필요).

const enqueueNotification = vi.fn(async () => {});
vi.mock("@/lib/zalo", () => ({ enqueueNotification: (...a: unknown[]) => enqueueNotification(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

import { writeAuditLog } from "@/lib/audit-log";
import {
  transitionSettlement,
  SettlementTransitionError,
} from "@/lib/settlement";

function mockDb(current: SettlementStatus) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findUnique = vi.fn(async () => ({
    id: "s-1",
    status: current,
    supplierId: "sup-1",
    yearMonth: "2026-07",
    totalVnd: 5_000_000n,
  }));
  const findUniqueOrThrow = vi.fn(async () => ({
    id: "s-1",
    status: current,
    totalVnd: 5_000_000n,
    collectedAt: null,
    fxAdjustedAt: null,
    fxAdjustmentVnd: null,
    paidAt: null,
  }));
  const tx = { settlement: { findUnique, updateMany, findUniqueOrThrow } };
  const db = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  return { db, updateMany, findUnique };
}

beforeEach(() => vi.clearAllMocks());

describe("transitionSettlement — P2-2 생애주기", () => {
  it("COLLECT(CONFIRMED→COLLECTED): collectedAt 스탬프", async () => {
    const { db, updateMany } = mockDb(SettlementStatus.CONFIRMED);
    await transitionSettlement("s-1", "COLLECT", "admin-1", db as never);
    const data = updateMany.mock.calls[0][0].data;
    expect(data.status).toBe(SettlementStatus.COLLECTED);
    expect(data.collectedAt).toBeInstanceOf(Date);
    expect(data.paidAt).toBeUndefined();
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it("ADJUST_FX(COLLECTED→FX_ADJUSTED): fxAdjustmentVnd(음수 손실)·fxAdjustedAt 영속", async () => {
    const { db, updateMany } = mockDb(SettlementStatus.COLLECTED);
    await transitionSettlement("s-1", "ADJUST_FX", "admin-1", db as never, {
      fxAdjustmentVnd: -150_000n,
    });
    const data = updateMany.mock.calls[0][0].data;
    expect(data.status).toBe(SettlementStatus.FX_ADJUSTED);
    expect(data.fxAdjustmentVnd).toBe(-150_000n);
    expect(data.fxAdjustedAt).toBeInstanceOf(Date);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "Settlement", action: "UPDATE" })
    );
  });

  it("ADJUST_FX 금액 미지정 → 0n 기록(환차 없음 명시)", async () => {
    const { db, updateMany } = mockDb(SettlementStatus.COLLECTED);
    await transitionSettlement("s-1", "ADJUST_FX", "admin-1", db as never);
    expect(updateMany.mock.calls[0][0].data.fxAdjustmentVnd).toBe(0n);
  });

  it("MARK_PAID(COLLECTED→PAID): paidAt + SETTLEMENT_READY 알림 큐", async () => {
    const { db, updateMany } = mockDb(SettlementStatus.COLLECTED);
    await transitionSettlement("s-1", "MARK_PAID", "admin-1", db as never);
    expect(updateMany.mock.calls[0][0].data.paidAt).toBeInstanceOf(Date);
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "sup-1" })
    );
  });

  it("잘못된 전이(DRAFT→COLLECT) → SettlementTransitionError", async () => {
    const { db } = mockDb(SettlementStatus.DRAFT);
    await expect(
      transitionSettlement("s-1", "COLLECT", "admin-1", db as never)
    ).rejects.toBeInstanceOf(SettlementTransitionError);
  });
});
