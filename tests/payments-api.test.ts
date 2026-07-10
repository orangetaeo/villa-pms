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
// 파트너 채권(ADR-0022) — 가드(직접입금 차단)·tx 반영용
const rcvGuardFindUnique = vi.fn(); // prisma.partnerReceivable.findUnique (가드 사전조회)
const rcvTxFindUnique = vi.fn(); // tx.partnerReceivable.findUnique (입금 반영)
const rcvTxUpdate = vi.fn();
const tx = {
  // 채권 입금 직렬화용 advisory lock(pg_advisory_xact_lock) — 테스트에선 no-op.
  $executeRaw: async () => 0,
  payment: {
    create: (...a: unknown[]) => paymentCreate(...a),
    findUnique: (...a: unknown[]) => paymentFindUniqueTx(...a),
    delete: (...a: unknown[]) => paymentDeleteTx(...a),
  },
  partnerReceivable: {
    findUnique: (...a: unknown[]) => rcvTxFindUnique(...a),
    update: (...a: unknown[]) => rcvTxUpdate(...a),
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
    partnerReceivable: { findUnique: (...a: unknown[]) => rcvGuardFindUnique(...a) },
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
  rcvGuardFindUnique.mockResolvedValue(null); // 기본: 채권 없음(가드 미적용)
  rcvTxFindUnique.mockResolvedValue(null);
  rcvTxUpdate.mockResolvedValue({});
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

  // ── 이중입금 가드 (ADR-0022 3b-2): 청구서에 묶인 채권엔 직접 DEPOSIT/BALANCE 금지 ──
  it("청구서에 묶인 채권 + DEPOSIT → 409 RECEIVABLE_INVOICED (payment 미생성)", async () => {
    rcvGuardFindUnique.mockResolvedValue({ invoiceId: "inv-1" });
    const res = await postReq("bk-1", { ...VALID_VND, purpose: "DEPOSIT" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "RECEIVABLE_INVOICED" });
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("청구서 묶인 채권이라도 GUEST 입금은 통과(하위호환) → 201", async () => {
    rcvGuardFindUnique.mockResolvedValue({ invoiceId: "inv-1" });
    const res = await postReq("bk-1", VALID_VND); // purpose 미지정 = GUEST
    expect(res.status).toBe(201);
    expect(paymentCreate).toHaveBeenCalled();
  });

  it("청구서에 안 묶인 채권 + BALANCE → 통과 201", async () => {
    rcvGuardFindUnique.mockResolvedValue({ invoiceId: null });
    const res = await postReq("bk-1", { ...VALID_VND, purpose: "BALANCE" });
    expect(res.status).toBe(201);
    expect(paymentCreate).toHaveBeenCalled();
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

  it("파트너 선금(DEPOSIT) 결제 삭제 → 채권 카운터도 되돌림", async () => {
    paymentFindUniqueTx.mockResolvedValue({
      id: "pay-d",
      bookingId: "bk-1",
      currency: "VND",
      amount: 3_000_000n,
      invoiceId: null,
      purpose: "DEPOSIT",
      vndEquivalent: 3_000_000n,
      receivableId: "rcv-1",
    });
    // 삭제 전 채권: 선금 3,000,000 반영된 상태
    rcvTxFindUnique.mockResolvedValue({
      totalVnd: 10_000_000n,
      depositPaidVnd: 3_000_000n,
      balancePaidVnd: 0n,
    });
    const res = await delReq("pay-d");
    expect(res.status).toBe(200);
    // 채권 선금 카운터가 0으로 되돌려지고 상태 PENDING 재계산
    expect(rcvTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rcv-1" },
        data: expect.objectContaining({ depositPaidVnd: 0n, status: "PENDING" }),
      })
    );
    expect(paymentDeleteTx).toHaveBeenCalledWith({ where: { id: "pay-d" } });
  });

  it("일반 고객 입금(GUEST·receivable 없음) 삭제 → 채권 미수정", async () => {
    paymentFindUniqueTx.mockResolvedValue({
      id: "pay-g",
      bookingId: "bk-1",
      currency: "VND",
      amount: 1_000_000n,
      invoiceId: null,
      purpose: "GUEST",
      vndEquivalent: 1_000_000n,
      receivableId: null,
    });
    const res = await delReq("pay-g");
    expect(res.status).toBe(200);
    expect(rcvTxUpdate).not.toHaveBeenCalled();
  });
});
