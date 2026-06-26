import { describe, expect, it, vi } from "vitest";
import { CreditTier, ReceivableStatus, type Partner } from "@prisma/client";
import {
  isOverLimit,
  summarizeReceivables,
  type PartnerAggregate,
} from "./partner-server";
import { markOverdueReceivables } from "./partner-booking";

function agg(o: {
  id: string;
  tier?: CreditTier;
  limit?: bigint;
  outstanding: bigint;
  overdue?: boolean;
  over30?: bigint;
}): PartnerAggregate {
  const over30 = o.over30 ?? 0n;
  return {
    partner: {
      id: o.id,
      name: o.id,
      type: "TRAVEL_AGENCY",
      creditTier: o.tier ?? CreditTier.B,
      creditLimitVnd: o.limit ?? 0n,
    } as Partner,
    outstandingVnd: o.outstanding,
    aging: {
      "0-7": o.outstanding - over30 > 0n ? o.outstanding - over30 : 0n,
      "8-15": 0n,
      "16-30": 0n,
      "30+": over30,
      total: o.outstanding,
    },
    overdue: o.overdue ?? false,
    bookingCount: 0,
  };
}

describe("isOverLimit", () => {
  it("등급 A는 항상 false(여신 없음)", () => {
    expect(isOverLimit(agg({ id: "a", tier: CreditTier.A, outstanding: 9_000_000n }))).toBe(false);
  });
  it("등급 B 미수 > 한도 → true", () => {
    expect(
      isOverLimit(agg({ id: "b", tier: CreditTier.B, limit: 5_000_000n, outstanding: 6_000_000n }))
    ).toBe(true);
  });
  it("한도와 같으면 false(초과 아님)", () => {
    expect(
      isOverLimit(agg({ id: "b", tier: CreditTier.B, limit: 5_000_000n, outstanding: 5_000_000n }))
    ).toBe(false);
  });
});

describe("summarizeReceivables", () => {
  it("미수 0 파트너는 제외, 총액·Aging 합산", () => {
    const o = summarizeReceivables([
      agg({ id: "a", outstanding: 1_000_000n }),
      agg({ id: "zero", outstanding: 0n }),
      agg({ id: "b", outstanding: 2_000_000n, over30: 500_000n }),
    ]);
    expect(o.partners.map((p) => p.partner.id).sort()).toEqual(["a", "b"]);
    expect(o.totalOutstandingVnd).toBe(3_000_000n);
    expect(o.aging["30+"]).toBe(500_000n);
    expect(o.aging.total).toBe(3_000_000n);
  });

  it("연체 우선·미수액 내림차순 정렬", () => {
    const o = summarizeReceivables([
      agg({ id: "small-normal", outstanding: 500_000n, overdue: false }),
      agg({ id: "big-normal", outstanding: 9_000_000n, overdue: false }),
      agg({ id: "overdue", outstanding: 1_000_000n, overdue: true }),
    ]);
    expect(o.partners.map((p) => p.partner.id)).toEqual([
      "overdue",
      "big-normal",
      "small-normal",
    ]);
  });

  it("연체·한도초과 카운트와 연체 미수 합계", () => {
    const o = summarizeReceivables([
      agg({ id: "od1", tier: CreditTier.B, limit: 1_000_000n, outstanding: 2_000_000n, overdue: true }),
      agg({ id: "ok", tier: CreditTier.B, limit: 9_000_000n, outstanding: 1_000_000n, overdue: false }),
      agg({ id: "A-no-limit", tier: CreditTier.A, outstanding: 5_000_000n, overdue: false }),
    ]);
    expect(o.overduePartnerCount).toBe(1);
    expect(o.overdueOutstandingVnd).toBe(2_000_000n);
    expect(o.overLimitPartnerCount).toBe(1); // od1만(등급A는 한도 무관)
  });
});

describe("markOverdueReceivables", () => {
  const utc = (s: string) => new Date(`${s}T12:00:00.000Z`); // 정오 입력이어도 UTC 자정으로 정규화

  it("PENDING/PARTIAL + 기한 경과 → OVERDUE updateMany, count 반환", async () => {
    const updateMany = vi.fn(
      (_args: { where: { status: unknown; dueDate: { lt: Date } }; data: unknown }) =>
        Promise.resolve({ count: 3 })
    );
    const db = { partnerReceivable: { updateMany } } as unknown as Parameters<
      typeof markOverdueReceivables
    >[0];
    const n = await markOverdueReceivables(db, utc("2026-07-10"));
    expect(n).toBe(3);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0]![0];
    expect(arg.data).toEqual({ status: ReceivableStatus.OVERDUE });
    expect(arg.where.status).toEqual({
      in: [ReceivableStatus.PENDING, ReceivableStatus.PARTIAL],
    });
    // dueDate < 오늘 UTC 자정
    expect(arg.where.dueDate.lt.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });
});
