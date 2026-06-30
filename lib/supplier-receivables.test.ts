import { describe, expect, it } from "vitest";
import { summarizeSupplierReceivables, type BookingSeller } from "./supplier-receivables";

// 예약 1건 빌더 — 기본 seller=OPERATOR(우리회사 판매)
const b = (
  ym: string,
  amount: bigint,
  villaId = "v1",
  villaName = "Villa 1",
  seller: BookingSeller = "OPERATOR"
) => ({
  checkOut: new Date(`${ym}-15T00:00:00.000Z`),
  supplierCostVnd: amount,
  villaId,
  villaName,
  seller,
});

describe("summarizeSupplierReceivables", () => {
  it("우리회사 판매: PAID 월=받음, 미PAID 월=미수", () => {
    const r = summarizeSupplierReceivables(
      [b("2026-05", 1_000_000n), b("2026-06", 2_000_000n), b("2026-07", 3_000_000n)],
      [{ yearMonth: "2026-05", status: "PAID" }]
    );
    expect(r.totalVnd).toBe(6_000_000n);
    expect(r.paidVnd).toBe(1_000_000n);
    expect(r.outstandingVnd).toBe(5_000_000n);
    expect(r.directVnd).toBe(0n);
    expect(r.unpaidMonths).toEqual([
      { yearMonth: "2026-07", amountVnd: 3_000_000n },
      { yearMonth: "2026-06", amountVnd: 2_000_000n },
    ]);
  });

  it("직접 판매(SUPPLIER)는 미수 아님 — directVnd로만 집계", () => {
    const r = summarizeSupplierReceivables(
      [
        b("2026-06", 2_000_000n, "vA", "A", "OPERATOR"), // 미수
        b("2026-06", 5_000_000n, "vA", "A", "SUPPLIER"), // 직접 — 미수 아님
        b("2026-05", 1_000_000n, "vB", "B", "SUPPLIER"), // 직접
      ],
      []
    );
    expect(r.outstandingVnd).toBe(2_000_000n); // OPERATOR만
    expect(r.directVnd).toBe(6_000_000n); // SUPPLIER 합
    expect(r.unpaidMonths).toEqual([{ yearMonth: "2026-06", amountVnd: 2_000_000n }]); // OPERATOR만
    const vA = r.byVilla.find((v) => v.villaId === "vA")!;
    expect(vA).toMatchObject({ outstandingVnd: 2_000_000n, directVnd: 5_000_000n });
    const vB = r.byVilla.find((v) => v.villaId === "vB")!;
    expect(vB).toMatchObject({ paidVnd: 0n, outstandingVnd: 0n, directVnd: 1_000_000n });
  });

  it("빈 목록 → 전부 0", () => {
    const r = summarizeSupplierReceivables([], []);
    expect(r).toEqual({
      totalVnd: 0n,
      paidVnd: 0n,
      outstandingVnd: 0n,
      directVnd: 0n,
      unpaidMonths: [],
      byVilla: [],
    });
  });
});
