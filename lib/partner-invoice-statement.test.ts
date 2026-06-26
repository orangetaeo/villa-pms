import { describe, expect, it } from "vitest";
import {
  buildInvoiceStatementModel,
  type InvoiceStatementInput,
} from "@/lib/partner-invoice-statement";

const base: InvoiceStatementInput = {
  partnerName: "Công ty Du lịch ABC",
  invoiceNo: "INV-ABC123",
  periodStart: "2026.07.01",
  periodEnd: "2026.07.15",
  dueDate: "2026.07.22",
  issuedAt: "2026.07.16",
  lines: [
    { villaName: "Villa Sao Biển", stay: "2026.07.03 ~ 2026.07.06", nights: 3, amountVnd: 9_000_000n },
    { villaName: "Villa Hoàng Hôn", stay: "2026.07.10 ~ 2026.07.12", nights: 2, amountVnd: 6_000_000n },
  ],
};

describe("buildInvoiceStatementModel — 청구서 모델", () => {
  it("라인·총액 vi 포맷(₫·천단위 콤마), 총액=라인 합", () => {
    const m = buildInvoiceStatementModel(base);
    expect(m.rows).toHaveLength(2);
    expect(m.rows[0]).toEqual({
      villaName: "Villa Sao Biển",
      stay: "2026.07.03 ~ 2026.07.06",
      nights: "3",
      amount: "9,000,000₫",
    });
    expect(m.total).toBe("15,000,000₫");
    expect(m.partnerName).toBe("Công ty Du lịch ABC");
  });

  it("기수납 없으면 paid·outstanding null", () => {
    const m = buildInvoiceStatementModel(base);
    expect(m.paid).toBeNull();
    expect(m.outstanding).toBeNull();
  });

  it("부분수납 시 수납·잔액 표기", () => {
    const m = buildInvoiceStatementModel({ ...base, paidVnd: 5_000_000n });
    expect(m.paid).toBe("5,000,000₫");
    expect(m.outstanding).toBe("10,000,000₫");
  });

  it("과수납이어도 잔액은 0으로 클램프", () => {
    const m = buildInvoiceStatementModel({ ...base, paidVnd: 20_000_000n });
    expect(m.outstanding).toBe("0₫");
  });

  it("라인 0건이면 throw(빈 청구서)", () => {
    expect(() => buildInvoiceStatementModel({ ...base, lines: [] })).toThrow();
  });
});
