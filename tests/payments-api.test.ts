import { beforeEach, describe, expect, it, vi } from "vitest";

// 실수납 결제 API 가드·계산 검증 (정산 2차 P2-1)
// 핸들러 직접호출 + mock. canViewFinance·computeVndEquivalent는 실구현 사용.

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const bookingFindUnique = vi.fn();
const paymentCreate = vi.fn();
const paymentFindMany = vi.fn();
const paymentFindUniqueTx = vi.fn();
const paymentDeleteTx = vi.fn();
const ledgerFindUnique = vi.fn();
const ledgerCreate = vi.fn();
const ledgerDeleteMany = vi.fn();
const tx = {
  payment: {
    create: (...a: unknown[]) => paymentCreate(...a),
    findUnique: (...a: unknown[]) => paymentFindUniqueTx(...a),
    delete: (...a: unknown[]) => paymentDeleteTx(...a),
  },
  // LEDGER 복식부기 적재(ADR-0018) — postCollection/reverseCollection이 tx에서 호출.
  ledgerTransaction: {
    findUnique: (...a: unknown[]) => ledgerFindUnique(...a),
    create: (...a: unknown[]) => ledgerCreate(...a),
    deleteMany: (...a: unknown[]) => ledgerDeleteMany(...a),
  },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findUnique: (...a: unknown[]) => bookingFindUnique(...a) },
    payment: { findMany: (...a: unknown[]) => paymentFindMany(...a) },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { POST, GET } from "@/app/api/bookings/[id]/payments/route";
import { DELETE } from "@/app/api/payments/[id]/route";

const ADMIN = { user: { id: "admin-1", role: "ADMIN" } };
const STAFF = { user: { id: "staff-1", role: "STAFF" } };

const VND_BOOKING = {
  id: "bk-1",
  saleCurrency: "VND",
  totalSaleKrw: null,
  totalSaleVnd: 10_000_000n,
  fxVndPerKrw: null,
};

const postReq = (id: string, body: unknown) =>
  POST(
    new Request(`http://local/api/bookings/${id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

const getReq = (id: string) =>
  GET(new Request(`http://local/api/bookings/${id}/payments`), {
    params: Promise.resolve({ id }),
  });

const delReq = (id: string) =>
  DELETE(new Request(`http://local/api/payments/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(ADMIN);
  bookingFindUnique.mockResolvedValue(VND_BOOKING);
  paymentCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "pay-1",
    createdAt: new Date(),
    ...data,
  }));
  paymentFindMany.mockResolvedValue([]);
  ledgerFindUnique.mockResolvedValue(null); // 멱등 가드: 기존 거래 없음
  ledgerCreate.mockResolvedValue({ id: "ledger-1" });
  ledgerDeleteMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/bookings/[id]/payments — 결제 기록 가드·계산", () => {
  const VALID_VND = {
    currency: "VND",
    amount: "5000000",
    method: "VN_BANK_TRANSFER",
    receivedAt: "2026-07-01",
  };

  it("비인증 → 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await postReq("bk-1", VALID_VND)).status).toBe(401);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("STAFF(비재무) → 403 (수납액 비노출)", async () => {
    mockAuth.mockResolvedValue(STAFF);
    expect((await postReq("bk-1", VALID_VND)).status).toBe(403);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("없는 예약 → 404", async () => {
    bookingFindUnique.mockResolvedValue(null);
    expect((await postReq("ghost", VALID_VND)).status).toBe(404);
  });

  it("VND 결제 정상 → 201, vndEquivalent=원금, AuditLog", async () => {
    const res = await postReq("bk-1", VALID_VND);
    expect(res.status).toBe(201);
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "bk-1",
          currency: "VND",
          amount: 5_000_000n,
          vndEquivalent: 5_000_000n,
          fxRateToVnd: null,
        }),
      })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATE", entity: "Payment" })
    );
  });

  it("KRW + 환율 → 201, vndEquivalent half-up 계산", async () => {
    const res = await postReq("bk-1", {
      currency: "KRW",
      amount: "1000000",
      method: "KR_BANK_TRANSFER",
      receivedAt: "2026-07-01",
      fxRateToVnd: "18.5",
    });
    expect(res.status).toBe(201);
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currency: "KRW",
          vndEquivalent: 18_500_000n,
          fxRateToVnd: "18.5",
        }),
      })
    );
  });

  it("KRW인데 환율 누락 → 400 FX_REQUIRED_FOR_KRW", async () => {
    const res = await postReq("bk-1", {
      currency: "KRW",
      amount: "1000000",
      method: "KR_BANK_TRANSFER",
      receivedAt: "2026-07-01",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "FX_REQUIRED_FOR_KRW" });
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("잘못된 body → 400", async () => {
    const res = await postReq("bk-1", { currency: "USD", amount: "x" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/bookings/[id]/payments — 수납 요약", () => {
  it("STAFF → 403", async () => {
    mockAuth.mockResolvedValue(STAFF);
    expect((await getReq("bk-1")).status).toBe(403);
  });

  it("부분입금 → PARTIAL, 미수 잔액 (VND 예약)", async () => {
    paymentFindMany.mockResolvedValue([
      { currency: "VND", amount: 3_000_000n, vndEquivalent: 3_000_000n },
    ]);
    const res = await getReq("bk-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.status).toBe("PARTIAL");
    expect(body.summary.outstandingVnd).toBe("7000000"); // 10,000,000 − 3,000,000
    expect(body.summary.collectedVndEquivalent).toBe("3000000");
  });

  it("KRW 예약 환율 스냅샷 없으면 FX_UNKNOWN (미수 산출 불가)", async () => {
    bookingFindUnique.mockResolvedValue({
      id: "bk-2",
      saleCurrency: "KRW",
      totalSaleKrw: 1_000_000,
      totalSaleVnd: null,
      fxVndPerKrw: null,
    });
    paymentFindMany.mockResolvedValue([]);
    const body = await (await getReq("bk-2")).json();
    expect(body.summary.status).toBe("FX_UNKNOWN");
    expect(body.summary.outstandingVnd).toBeNull();
  });
});

describe("DELETE /api/payments/[id] — 결제 삭제 가드", () => {
  it("STAFF → 403", async () => {
    mockAuth.mockResolvedValue(STAFF);
    expect((await delReq("pay-1")).status).toBe(403);
  });

  it("없는 결제 → 404", async () => {
    paymentFindUniqueTx.mockResolvedValue(null);
    expect((await delReq("ghost")).status).toBe(404);
  });

  it("정상 삭제 → 200, AuditLog(DELETE)", async () => {
    paymentFindUniqueTx.mockResolvedValue({
      id: "pay-1",
      bookingId: "bk-1",
      currency: "VND",
      amount: 5_000_000n,
    });
    const res = await delReq("pay-1");
    expect(res.status).toBe(200);
    expect(paymentDeleteTx).toHaveBeenCalledWith({ where: { id: "pay-1" } });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELETE", entity: "Payment", entityId: "pay-1" })
    );
  });
});
