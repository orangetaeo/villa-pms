import { describe, expect, it } from "vitest";
import ko from "@/messages/ko.json";
import vi from "@/messages/vi.json";

// T-supplier-settlement-list 공급자 정산서 목록 — i18n 키 존재·ko/vi 동기 검증.
// next-intl은 누락 키에 throw → 양쪽 동등성 보장으로 런타임 깨짐 방지 (LOC 패턴).
const SETTLEMENTS_KEYS = [
  "title",
  "subtitle",
  "back",
  "monthLabel",
  "totalLabel",
  "statusPaid",
  "statusPending",
  "viewPdf",
  "viewPdfAria",
  "pdfPreparing",
  "empty",
  "emptyHint",
] as const;

describe("i18n 키 — supplierSettlements (a8)", () => {
  it("ko/vi 모두 supplierSettlements 네임스페이스 보유", () => {
    expect(ko.supplierSettlements).toBeDefined();
    expect(vi.supplierSettlements).toBeDefined();
  });
  it.each(SETTLEMENTS_KEYS)("키 '%s' 존재 (ko·vi 비어있지 않음)", (key) => {
    expect((ko.supplierSettlements as Record<string, string>)[key]?.length).toBeGreaterThan(0);
    expect((vi.supplierSettlements as Record<string, string>)[key]?.length).toBeGreaterThan(0);
  });
});

describe("i18n 키 — earnings.viewStatements (정산서 진입 링크)", () => {
  it("ko/vi 모두 earnings.viewStatements 보유", () => {
    expect((ko.earnings as Record<string, string>).viewStatements?.length).toBeGreaterThan(0);
    expect((vi.earnings as Record<string, string>).viewStatements?.length).toBeGreaterThan(0);
  });
});
