import { describe, expect, it, vi } from "vitest";
import { CreditTier, PartnerStatus, ReceivableStatus } from "@prisma/client";
import {
  applyPaymentToReceivable,
  creditPortionVnd,
  ensureReceivableForBooking,
  evaluateConfirmCredit,
  partnerBalanceBlocksCheckIn,
} from "./partner-booking";

describe("creditPortionVnd", () => {
  it("여신 노출 = 객실료 − 선금", () => {
    expect(creditPortionVnd(1_000_000n, 300_000n)).toBe(700_000n);
  });
  it("선금이 총액 이상이면 0", () => {
    expect(creditPortionVnd(1_000_000n, 1_200_000n)).toBe(0n);
  });
});

describe("applyPaymentToReceivable", () => {
  const base = { totalVnd: 1_000_000n, depositPaidVnd: 0n, balancePaidVnd: 0n };
  it("선금 입금 → depositPaid 누적, PARTIAL", () => {
    const r = applyPaymentToReceivable(base, "DEPOSIT", 300_000n);
    expect(r.depositPaidVnd).toBe(300_000n);
    expect(r.balancePaidVnd).toBe(0n);
    expect(r.status).toBe(ReceivableStatus.PARTIAL);
  });
  it("잔금까지 완납 → PAID", () => {
    const r = applyPaymentToReceivable(
      { totalVnd: 1_000_000n, depositPaidVnd: 300_000n, balancePaidVnd: 0n },
      "BALANCE",
      700_000n
    );
    expect(r.balancePaidVnd).toBe(700_000n);
    expect(r.status).toBe(ReceivableStatus.PAID);
  });
  it("과입금이어도 PAID(음수 없음)", () => {
    const r = applyPaymentToReceivable(base, "DEPOSIT", 1_500_000n);
    expect(r.status).toBe(ReceivableStatus.PAID);
  });
  it("0 입금 → PENDING 유지", () => {
    const r = applyPaymentToReceivable(base, "DEPOSIT", 0n);
    expect(r.status).toBe(ReceivableStatus.PENDING);
  });
});

describe("partnerBalanceBlocksCheckIn", () => {
  const unpaid = { totalVnd: 1_000_000n, depositPaidVnd: 300_000n, balancePaidVnd: 0n };
  const paid = { totalVnd: 1_000_000n, depositPaidVnd: 1_000_000n, balancePaidVnd: 0n };
  it("등급 A + 잔금 미납 → 차단", () => {
    expect(partnerBalanceBlocksCheckIn(CreditTier.A, unpaid)).toBe(true);
  });
  it("등급 A + 완납 → 통과", () => {
    expect(partnerBalanceBlocksCheckIn(CreditTier.A, paid)).toBe(false);
  });
  it("등급 B(여신)는 미납이어도 통과", () => {
    expect(partnerBalanceBlocksCheckIn(CreditTier.B, unpaid)).toBe(false);
  });
  it("채권 없음 → 통과", () => {
    expect(partnerBalanceBlocksCheckIn(CreditTier.A, null)).toBe(false);
  });
});

// ── DB 헬퍼 (tx mock) ──

function makeTx(booking: unknown, others: unknown[] = []) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "rcv-new",
    ...data,
  }));
  const tx = {
    booking: { findUnique: vi.fn(async () => booking) },
    partnerReceivable: {
      findMany: vi.fn(async () => others),
      create,
    },
  };
  return { tx: tx as never, create };
}

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("evaluateConfirmCredit", () => {
  it("파트너 미연결 → skipped, allowed", async () => {
    const { tx } = makeTx({ id: "b1", partnerId: null, totalSaleVnd: 1_000_000n, partner: null });
    const r = await evaluateConfirmCredit(tx, "b1", utc("2026-07-01"));
    expect(r.skipped).toBe(true);
    expect(r.allowed).toBe(true);
  });

  it("등급 B 한도 내 → allowed", async () => {
    const { tx } = makeTx(
      {
        id: "b1",
        partnerId: "p1",
        totalSaleVnd: 5_000_000n,
        partner: {
          creditTier: CreditTier.B,
          status: PartnerStatus.ACTIVE,
          creditLimitVnd: 10_000_000n,
          depositRatePct: 30,
        },
      },
      []
    );
    const r = await evaluateConfirmCredit(tx, "b1", utc("2026-07-01"));
    expect(r.allowed).toBe(true);
  });

  it("등급 B 한도 초과 → 차단(LIMIT_EXCEEDED)", async () => {
    const others = [
      {
        totalVnd: 9_000_000n,
        depositPaidVnd: 0n,
        balancePaidVnd: 0n,
        dueDate: utc("2026-08-01"),
        status: ReceivableStatus.PENDING,
      },
    ];
    const { tx } = makeTx(
      {
        id: "b1",
        partnerId: "p1",
        totalSaleVnd: 5_000_000n, // 여신 3.5M + 기존 9M > 10M
        partner: {
          creditTier: CreditTier.B,
          status: PartnerStatus.ACTIVE,
          creditLimitVnd: 10_000_000n,
          depositRatePct: 30,
        },
      },
      others
    );
    const r = await evaluateConfirmCredit(tx, "b1", utc("2026-07-01"));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("LIMIT_EXCEEDED");
  });

  it("BLOCKED 파트너 → 차단", async () => {
    const { tx } = makeTx({
      id: "b1",
      partnerId: "p1",
      totalSaleVnd: 1_000_000n,
      partner: {
        creditTier: CreditTier.B,
        status: PartnerStatus.BLOCKED,
        creditLimitVnd: 99_000_000n,
        depositRatePct: 30,
      },
    });
    const r = await evaluateConfirmCredit(tx, "b1", utc("2026-07-01"));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("BLOCKED");
  });

  it("등급 A 선불은 한도 무관 통과", async () => {
    const others = [
      {
        totalVnd: 50_000_000n,
        depositPaidVnd: 0n,
        balancePaidVnd: 0n,
        dueDate: utc("2026-08-01"),
        status: ReceivableStatus.PENDING,
      },
    ];
    const { tx } = makeTx(
      {
        id: "b1",
        partnerId: "p1",
        totalSaleVnd: 5_000_000n,
        partner: {
          creditTier: CreditTier.A,
          status: PartnerStatus.ACTIVE,
          creditLimitVnd: 0n,
          depositRatePct: 30,
        },
      },
      others
    );
    const r = await evaluateConfirmCredit(tx, "b1", utc("2026-07-01"));
    expect(r.allowed).toBe(true);
  });
});

describe("ensureReceivableForBooking", () => {
  it("파트너 미연결 → 생성 안 함", async () => {
    const { tx, create } = makeTx({
      id: "b1",
      partnerId: null,
      totalSaleVnd: 1_000_000n,
      checkIn: utc("2026-07-10"),
      partner: null,
      receivable: null,
    });
    expect(await ensureReceivableForBooking(tx, "b1", utc("2026-07-01"))).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("이미 채권 존재 → 멱등(생성 안 함)", async () => {
    const { tx, create } = makeTx({
      id: "b1",
      partnerId: "p1",
      totalSaleVnd: 1_000_000n,
      checkIn: utc("2026-07-10"),
      partner: { creditTier: CreditTier.A, depositRatePct: 30, paymentTermDays: 0 },
      receivable: { id: "rcv-existing" },
    });
    expect(await ensureReceivableForBooking(tx, "b1", utc("2026-07-01"))).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("등급 A → 선금 30%·기한=체크인일로 생성", async () => {
    const { tx, create } = makeTx({
      id: "b1",
      partnerId: "p1",
      totalSaleVnd: 1_000_000n,
      checkIn: utc("2026-07-10"),
      partner: { creditTier: CreditTier.A, depositRatePct: 30, paymentTermDays: 0 },
      receivable: null,
    });
    await ensureReceivableForBooking(tx, "b1", utc("2026-07-01"));
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        partnerId: "p1",
        bookingId: "b1",
        totalVnd: 1_000_000n,
        depositDueVnd: 300_000n,
        status: ReceivableStatus.PENDING,
      }),
    });
    const arg = create.mock.calls[0][0].data;
    expect((arg.dueDate as Date).toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("등급 B → 기한=체크인+termDays", async () => {
    const { tx, create } = makeTx({
      id: "b1",
      partnerId: "p1",
      totalSaleVnd: 2_000_000n,
      checkIn: utc("2026-07-10"),
      partner: { creditTier: CreditTier.B, depositRatePct: 30, paymentTermDays: 30 },
      receivable: null,
    });
    await ensureReceivableForBooking(tx, "b1", utc("2026-07-01"));
    const arg = create.mock.calls[0][0].data;
    expect((arg.dueDate as Date).toISOString()).toBe("2026-08-09T00:00:00.000Z");
    expect(arg.depositDueVnd).toBe(600_000n);
  });

  it("VND 객실료 없음 → 생성 안 함", async () => {
    const { tx, create } = makeTx({
      id: "b1",
      partnerId: "p1",
      totalSaleVnd: null,
      checkIn: utc("2026-07-10"),
      partner: { creditTier: CreditTier.A, depositRatePct: 30, paymentTermDays: 0 },
      receivable: null,
    });
    expect(await ensureReceivableForBooking(tx, "b1", utc("2026-07-01"))).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
