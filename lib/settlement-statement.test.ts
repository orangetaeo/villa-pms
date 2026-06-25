import { describe, expect, it } from "vitest";
import { buildStatementModel, fmtVnd, type StatementInput } from "@/lib/settlement-statement";

const base: StatementInput = {
  supplierName: "Trần Văn A",
  yearMonth: "2026-07",
  issuedAt: "2026.08.01",
  lines: [
    { villaName: "Villa Sao Biển", checkOut: "2026.07.05", nights: 3, amountVnd: 9_000_000n },
    { villaName: "Villa Hoàng Hôn", checkOut: "2026.07.20", nights: 2, amountVnd: 6_000_000n },
  ],
  totalVnd: 15_000_000n,
};

describe("buildStatementModel — 정산서 모델", () => {
  it("라인·합계 vi 포맷(₫·천단위 콤마)", () => {
    const m = buildStatementModel(base);
    expect(m.rows).toHaveLength(2);
    expect(m.rows[0]).toEqual({
      villaName: "Villa Sao Biển",
      checkOut: "2026.07.05",
      nights: "3",
      amount: "9,000,000₫",
    });
    expect(m.total).toBe("15,000,000₫");
    expect(m.supplierName).toBe("Trần Văn A");
    expect(m.yearMonth).toBe("2026-07");
  });

  it("라인 합 ≠ 총액이면 throw(집계 불일치)", () => {
    expect(() => buildStatementModel({ ...base, totalVnd: 14_000_000n })).toThrow(
      /불일치/
    );
  });

  it("환차 0·null이면 fxNote 없음, 값 있으면 부호 포함 표기", () => {
    expect(buildStatementModel(base).fxNote).toBeNull();
    expect(buildStatementModel({ ...base, fxAdjustmentVnd: 0n }).fxNote).toBeNull();
    expect(
      buildStatementModel({ ...base, fxAdjustmentVnd: -150_000n }).fxNote
    ).toBe("-150,000₫");
  });

  it("누수 차단 — 모델에 마진·판매가·KRW 필드 없음", () => {
    const m = buildStatementModel(base);
    const keys = JSON.stringify(m).toLowerCase();
    expect(keys).not.toContain("margin");
    expect(keys).not.toContain("krw");
    expect(keys).not.toContain("sale");
    expect(keys).not.toContain("won");
    // 모델 최상위 키는 정해진 8개만(원가/표시 전용)
    expect(Object.keys(m).sort()).toEqual(
      ["fxNote", "issuedAt", "rows", "supplierName", "total", "yearMonth"].sort()
    );
  });

  it("빈 정산(라인 0·총액 0)도 유효", () => {
    const m = buildStatementModel({ ...base, lines: [], totalVnd: 0n });
    expect(m.rows).toHaveLength(0);
    expect(m.total).toBe("0₫");
  });
});
