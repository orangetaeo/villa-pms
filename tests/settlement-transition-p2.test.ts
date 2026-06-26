import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettlementStatus } from "@prisma/client";

// 정산 2차 P2-2 — transitionSettlement 생애주기 전이 + 환차/타임스탬프 영속 검증.
// db는 인자로 주입 가능하므로 mock 객체를 직접 넘긴다(prisma mock 불필요).

const enqueueNotification = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/zalo", () => ({ enqueueNotification: (...a: unknown[]) => enqueueNotification(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

import { writeAuditLog } from "@/lib/audit-log";
import {
  transitionSettlement,
  SettlementTransitionError,
} from "@/lib/settlement";

function mockDb(current: SettlementStatus) {
  const updateMany = vi.fn(
    async (_args: { data: Record<string, unknown> }) => ({ count: 1 })
  );
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
  // 복식부기 LEDGER 분개 호출(P2-3) — transitionSettlement이 tx.ledgerTransaction 사용.
  // 기본값: 기존 분개 없음(findFirst→null) → create 발행. 멱등·환차 경로 모두 커버.
  const ledgerCreate = vi.fn(async () => ({ id: "lt-1" }));
  const ledgerDeleteMany = vi.fn(async () => ({ count: 0 }));
  const ledgerTransaction = {
    findUnique: vi.fn(async () => null),
    findFirst: vi.fn(async () => null),
    create: ledgerCreate,
    deleteMany: ledgerDeleteMany,
  };
  const tx = {
    settlement: { findUnique, updateMany, findUniqueOrThrow },
    ledgerTransaction,
  };
  const db = { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  return { db, updateMany, findUnique, ledgerCreate, ledgerDeleteMany };
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

describe("transitionSettlement — 복식부기 LEDGER 분개 (P2-3)", () => {
  it("COLLECT: COST_ACCRUAL 분개 1건 생성", async () => {
    const { db, ledgerCreate } = mockDb(SettlementStatus.CONFIRMED);
    await transitionSettlement("s-1", "COLLECT", "admin-1", db as never);
    expect(ledgerCreate).toHaveBeenCalledTimes(1);
  });

  it("MARK_PAID: 원가 적립 보장 + PAYOUT = 분개 2건(채무 잔액 0 유지)", async () => {
    // COLLECT를 건너뛴 CONFIRMED→PAID에서도 COST_ACCRUAL(멱등) + PAYOUT 모두 발행
    const { db, ledgerCreate } = mockDb(SettlementStatus.CONFIRMED);
    await transitionSettlement("s-1", "MARK_PAID", "admin-1", db as never);
    expect(ledgerCreate).toHaveBeenCalledTimes(2);
  });

  it("ADJUST_FX: 기존 FX 분개 삭제(replace) 후 재생성", async () => {
    const { db, ledgerCreate, ledgerDeleteMany } = mockDb(SettlementStatus.COLLECTED);
    await transitionSettlement("s-1", "ADJUST_FX", "admin-1", db as never, {
      fxAdjustmentVnd: 500_000n,
    });
    expect(ledgerDeleteMany).toHaveBeenCalledTimes(1); // replace
    expect(ledgerCreate).toHaveBeenCalledTimes(1);
  });

  it("ADJUST_FX 0n: 기존 FX 분개만 삭제, 신규 생성 없음", async () => {
    const { db, ledgerCreate, ledgerDeleteMany } = mockDb(SettlementStatus.COLLECTED);
    await transitionSettlement("s-1", "ADJUST_FX", "admin-1", db as never);
    expect(ledgerDeleteMany).toHaveBeenCalledTimes(1);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });
});
