import { describe, expect, it, vi } from "vitest";
import { BookingSeller } from "@prisma/client";
import { generateMonthlySettlements } from "@/lib/settlement";

// F10 T10.4 — 공급자 직접판매(seller=SUPPLIER)는 공급자 100% 수금이라 월 정산 집계에서 제외(ADR-0021 D3).
// 집계 쿼리 where에 seller=OPERATOR가 강제되는지 mock으로 잠근다.
describe("generateMonthlySettlements — 공급자 직접판매 정산 제외 (F10 T10.4)", () => {
  it("집계 booking.findMany where에 seller=OPERATOR 강제", async () => {
    let capturedWhere: Record<string, unknown> | null = null;
    const tx = {
      booking: {
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
          capturedWhere = args.where;
          return [];
        }),
      },
      settlement: { findMany: vi.fn(async () => []) },
      settlementItem: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    };
    const db = {
      $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
    } as unknown as Parameters<typeof generateMonthlySettlements>[1];

    const summary = await generateMonthlySettlements("2026-06", db);

    expect(capturedWhere).not.toBeNull();
    expect(capturedWhere!.seller).toBe(BookingSeller.OPERATOR);
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(0);
  });
});
