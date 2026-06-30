import { describe, expect, it } from "vitest";
import { summarizeSupplierReceivables } from "./supplier-receivables";

// 예약 1건 빌더 — checkOut을 특정 UTC 월 중순으로, 빌라 귀속 포함
const b = (ym: string, amount: bigint, villaId = "v1", villaName = "Villa 1") => ({
  checkOut: new Date(`${ym}-15T00:00:00.000Z`),
  supplierCostVnd: amount,
  villaId,
  villaName,
});

describe("summarizeSupplierReceivables", () => {
  it("PAID 월은 받음, 미PAID 월은 미수로 분류", () => {
    const r = summarizeSupplierReceivables(
      [
        b("2026-05", 1_000_000n),
        b("2026-05", 500_000n), // 5월 합 1.5M
        b("2026-06", 2_000_000n), // 6월 2M
        b("2026-07", 3_000_000n), // 7월 3M
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
      [b("2026-05", 1_000_000n)],
      [{ yearMonth: "2026-05", status: "PAID" }]
    );
    expect(r.outstandingVnd).toBe(0n);
    expect(r.unpaidMonths).toEqual([]);
    expect(r.paidVnd).toBe(1_000_000n);
  });

  it("예약 없으면 전부 0", () => {
    const r = summarizeSupplierReceivables([], []);
    expect(r).toEqual({
      totalVnd: 0n,
      paidVnd: 0n,
      outstandingVnd: 0n,
      unpaidMonths: [],
      byVilla: [],
    });
  });

  it("정산 레코드 없는 월은 미수(운영자 미지급)", () => {
    const r = summarizeSupplierReceivables([b("2026-06", 2_000_000n)], []);
    expect(r.outstandingVnd).toBe(2_000_000n);
    expect(r.unpaidMonths).toEqual([{ yearMonth: "2026-06", amountVnd: 2_000_000n }]);
  });

  it("빌라별 받음/미수 분해 — 미수 큰 순 정렬", () => {
    const r = summarizeSupplierReceivables(
      [
        b("2026-05", 1_000_000n, "vA", "Villa A"), // 5월 PAID → A 받음 1M
        b("2026-06", 2_000_000n, "vA", "Villa A"), // 6월 미PAID → A 미수 2M
        b("2026-06", 5_000_000n, "vB", "Villa B"), // 6월 미PAID → B 미수 5M
      ],
      [{ yearMonth: "2026-05", status: "PAID" }]
    );
    // B(미수 5M)가 A(미수 2M)보다 먼저
    expect(r.byVilla).toEqual([
      { villaId: "vB", villaName: "Villa B", paidVnd: 0n, outstandingVnd: 5_000_000n },
      { villaId: "vA", villaName: "Villa A", paidVnd: 1_000_000n, outstandingVnd: 2_000_000n },
    ]);
  });
});
