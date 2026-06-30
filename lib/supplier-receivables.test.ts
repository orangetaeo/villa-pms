import { describe, expect, it } from "vitest";
import { summarizeSupplierReceivables } from "./supplier-receivables";

// checkOut을 특정 UTC 월로 만드는 헬퍼 (월 중순 자정 UTC)
const co = (ym: string) => new Date(`${ym}-15T00:00:00.000Z`);

describe("summarizeSupplierReceivables", () => {
  it("PAID 월은 받음, 미PAID 월은 미수로 분류", () => {
    const r = summarizeSupplierReceivables(
      [
        { checkOut: co("2026-05"), supplierCostVnd: 1_000_000n },
        { checkOut: co("2026-05"), supplierCostVnd: 500_000n }, // 5월 합 1.5M
        { checkOut: co("2026-06"), supplierCostVnd: 2_000_000n }, // 6월 2M
        { checkOut: co("2026-07"), supplierCostVnd: 3_000_000n }, // 7월 3M
      ],
      [
        { yearMonth: "2026-05", status: "PAID" },
        { yearMonth: "2026-06", status: "CONFIRMED" }, // 미PAID → 미수
        // 2026-07은 정산 레코드 없음 → 미수
      ]
    );
    expect(r.totalVnd).toBe(6_500_000n);
    expect(r.paidVnd).toBe(1_500_000n);
    expect(r.outstandingVnd).toBe(5_000_000n);
    expect(r.unpaidMonths).toEqual([
      { yearMonth: "2026-07", amountVnd: 3_000_000n },
      { yearMonth: "2026-06", amountVnd: 2_000_000n },
    ]);
  });

  it("전부 PAID면 미수 0, 미납 목록 비어있음", () => {
    const r = summarizeSupplierReceivables(
      [{ checkOut: co("2026-05"), supplierCostVnd: 1_000_000n }],
      [{ yearMonth: "2026-05", status: "PAID" }]
    );
    expect(r.outstandingVnd).toBe(0n);
    expect(r.unpaidMonths).toEqual([]);
    expect(r.paidVnd).toBe(1_000_000n);
  });

  it("예약 없으면 전부 0", () => {
    const r = summarizeSupplierReceivables([], []);
    expect(r).toEqual({ totalVnd: 0n, paidVnd: 0n, outstandingVnd: 0n, unpaidMonths: [] });
  });

  it("정산 레코드 없는 월은 미수(운영자 미지급)", () => {
    const r = summarizeSupplierReceivables(
      [{ checkOut: co("2026-06"), supplierCostVnd: 2_000_000n }],
      []
    );
    expect(r.outstandingVnd).toBe(2_000_000n);
    expect(r.unpaidMonths).toEqual([{ yearMonth: "2026-06", amountVnd: 2_000_000n }]);
  });
});
