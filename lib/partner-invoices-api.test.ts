import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 청구서 API 라우트 테스트 (PARTNER-3b-2) — auth/leak/에러매핑.
 * 서비스 로직은 partner-invoice.test.ts가 담당 → 여기선 서비스 함수를 mock.
 */

const mockAuth = vi.fn();
const mockPartnerFindUnique = vi.fn();
const mockInvoiceFindMany = vi.fn();
const mockTxn = vi.fn();

vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    partner: { findUnique: (...a: unknown[]) => mockPartnerFindUnique(...a) },
    partnerInvoice: { findMany: (...a: unknown[]) => mockInvoiceFindMany(...a) },
    $transaction: (cb: (tx: unknown) => unknown) => mockTxn(cb),
  },
}));

// 서비스 함수만 mock, InvoiceError는 실제 클래스 유지(instanceof 매핑 검증)
const mockGenerate = vi.fn();
const mockIssue = vi.fn();
const mockVoid = vi.fn();
const mockRecordPayment = vi.fn();
vi.mock("@/lib/partner-invoice", async (orig) => {
  const actual = (await orig()) as object;
  return {
    ...actual,
    generateInvoiceForPeriod: (...a: unknown[]) => mockGenerate(...a),
    issueInvoice: (...a: unknown[]) => mockIssue(...a),
    voidInvoice: (...a: unknown[]) => mockVoid(...a),
    recordInvoicePayment: (...a: unknown[]) => mockRecordPayment(...a),
  };
});

import { InvoiceError } from "@/lib/partner-invoice";
import { GET, POST } from "../app/api/partners/[id]/invoices/route";
import { PATCH } from "../app/api/partner-invoices/[id]/route";
import { POST as PAY } from "../app/api/partner-invoices/[id]/payments/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockPartnerFindUnique.mockResolvedValue({ id: "p1", paymentTermDays: 30 });
  mockInvoiceFindMany.mockResolvedValue([]);
  // $transaction(cb) → cb({}) 실행 (서비스 mock이 tx 무시)
  mockTxn.mockImplementation((cb: (tx: unknown) => unknown) => cb({}));
  mockGenerate.mockResolvedValue({ invoice: { id: "inv1", totalVnd: 700_000n, status: "DRAFT" }, receivableCount: 2 });
  mockIssue.mockResolvedValue({ id: "inv1", status: "ISSUED" });
  mockVoid.mockResolvedValue({ id: "inv1", status: "VOID" });
  mockRecordPayment.mockResolvedValue({ id: "inv1", status: "PAID", paidVnd: 700_000n });
});

describe("POST /api/partners/[id]/invoices — 생성", () => {
  const body = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };
  it("비로그인 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST(jsonReq(body), params("p1"))).status).toBe(401);
  });
  it("STAFF 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "STAFF" } });
    expect((await POST(jsonReq(body), params("p1"))).status).toBe(403);
  });
  it("SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "SUPPLIER" } });
    expect((await POST(jsonReq(body), params("p1"))).status).toBe(403);
  });
  it("잘못된 기간 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    const res = await POST(jsonReq({ periodStart: "2026-07-31", periodEnd: "2026-07-01" }), params("p1"));
    expect(res.status).toBe(400);
  });
  it("파트너 없음 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    mockPartnerFindUnique.mockResolvedValue(null);
    expect((await POST(jsonReq(body), params("p1"))).status).toBe(404);
  });
  it("청구 잔금 0건 → 422", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    mockGenerate.mockRejectedValue(new InvoiceError("NO_RECEIVABLES"));
    expect((await POST(jsonReq(body), params("p1"))).status).toBe(422);
  });
  it("기간 중복 → 409", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    mockGenerate.mockRejectedValue(new InvoiceError("PERIOD_EXISTS"));
    expect((await POST(jsonReq(body), params("p1"))).status).toBe(409);
  });
  it("성공 201 + BigInt 직렬화", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    const res = await POST(jsonReq(body), params("p1"));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.totalVnd).toBe("700000");
  });
});

describe("GET /api/partners/[id]/invoices", () => {
  it("SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "SUPPLIER" } });
    expect((await GET(jsonReq({}), params("p1"))).status).toBe(403);
  });
  it("ADMIN 200", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    expect((await GET(jsonReq({}), params("p1"))).status).toBe(200);
  });
});

describe("PATCH /api/partner-invoices/[id]", () => {
  it("STAFF 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "STAFF" } });
    expect((await PATCH(jsonReq({ action: "issue" }), params("inv1"))).status).toBe(403);
  });
  it("발행 200", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    expect((await PATCH(jsonReq({ action: "issue" }), params("inv1"))).status).toBe(200);
    expect(mockIssue).toHaveBeenCalled();
  });
  it("이미 발행 → INVALID_STATUS 409", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    mockIssue.mockRejectedValue(new InvoiceError("INVALID_STATUS"));
    expect((await PATCH(jsonReq({ action: "issue" }), params("inv1"))).status).toBe(409);
  });
  it("없는 청구서 → 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    mockVoid.mockRejectedValue(new InvoiceError("NOT_FOUND"));
    expect((await PATCH(jsonReq({ action: "void" }), params("inv1"))).status).toBe(404);
  });
});

describe("POST /api/partner-invoices/[id]/payments", () => {
  it("SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "SUPPLIER" } });
    expect((await PAY(jsonReq({ amountVnd: "100" }), params("inv1"))).status).toBe(403);
  });
  it("수납 201", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    const res = await PAY(jsonReq({ amountVnd: "700000" }), params("inv1"));
    expect(res.status).toBe(201);
    expect(mockRecordPayment).toHaveBeenCalled();
  });
  it("DRAFT 수납 → 409", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    mockRecordPayment.mockRejectedValue(new InvoiceError("INVALID_STATUS"));
    expect((await PAY(jsonReq({ amountVnd: "1" }), params("inv1"))).status).toBe(409);
  });
});
