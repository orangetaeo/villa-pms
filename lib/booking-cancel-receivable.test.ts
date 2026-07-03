// 취소 시 파트너 채권 정리 테스트 (T-partner-admin-ops ① — 좀비 채권 방지)
import { describe, expect, it, vi } from "vitest";
import { ReceivableStatus, type Prisma } from "@prisma/client";
import { writeOffReceivableOnCancel } from "./partner-booking";

function fakeTx(o: {
  receivable:
    | {
        status: ReceivableStatus;
        invoiceId?: string | null;
        depositPaidVnd?: bigint;
        balancePaidVnd?: bigint;
      }
    | null;
  updateCount?: number;
}) {
  const updateMany = vi.fn(
    async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
      count: o.updateCount ?? 1,
    })
  );
  const tx = {
    partnerReceivable: {
      findUnique: vi.fn(async () =>
        o.receivable
          ? {
              id: "rcv1",
              status: o.receivable.status,
              invoiceId: o.receivable.invoiceId ?? null,
              depositPaidVnd: o.receivable.depositPaidVnd ?? 0n,
              balancePaidVnd: o.receivable.balancePaidVnd ?? 0n,
            }
          : null
      ),
      updateMany,
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, updateMany };
}

describe("writeOffReceivableOnCancel", () => {
  it("채권 없음 → NONE (updateMany 미호출)", async () => {
    const { tx, updateMany } = fakeTx({ receivable: null });
    expect(await writeOffReceivableOnCancel(tx, "b1")).toEqual({ kind: "NONE" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("이미 종결(PAID/WRITTEN_OFF) → NONE (불변)", async () => {
    for (const status of [ReceivableStatus.PAID, ReceivableStatus.WRITTEN_OFF]) {
      const { tx, updateMany } = fakeTx({ receivable: { status } });
      expect(await writeOffReceivableOnCancel(tx, "b1")).toEqual({ kind: "NONE" });
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it("청구서에 묶인 채권 → INVOICED_LEFT (자동 미접촉 — 청구서 총액 스냅샷 보호)", async () => {
    const { tx, updateMany } = fakeTx({
      receivable: { status: ReceivableStatus.PENDING, invoiceId: "inv9" },
    });
    expect(await writeOffReceivableOnCancel(tx, "b1")).toEqual({
      kind: "INVOICED_LEFT",
      receivableId: "rcv1",
      invoiceId: "inv9",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("미청구 PENDING/PARTIAL/OVERDUE → WRITTEN_OFF + 기입금액 보고(기록 보존)", async () => {
    const { tx, updateMany } = fakeTx({
      receivable: {
        status: ReceivableStatus.PARTIAL,
        depositPaidVnd: 9_000_000n,
        balancePaidVnd: 1_000_000n,
      },
    });
    const r = await writeOffReceivableOnCancel(tx, "b1");
    expect(r).toEqual({
      kind: "WRITTEN_OFF",
      receivableId: "rcv1",
      oldStatus: ReceivableStatus.PARTIAL,
      paidVnd: "10000000", // 환불/이월 수동 처리 대상 금액
    });
    // 가드 where — 동시 수납/청구서 묶기 경합 방지 (invoiceId null + 미종결 상태만)
    const where = updateMany.mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(where).toMatchObject({ id: "rcv1", invoiceId: null });
    expect(updateMany.mock.calls[0]![0]!.data).toEqual({
      status: ReceivableStatus.WRITTEN_OFF,
    });
  });

  it("경합(updateMany 0건 — 그 사이 수납/묶임) → NONE (보수적 미접촉)", async () => {
    const { tx } = fakeTx({
      receivable: { status: ReceivableStatus.PENDING },
      updateCount: 0,
    });
    expect(await writeOffReceivableOnCancel(tx, "b1")).toEqual({ kind: "NONE" });
  });
});
