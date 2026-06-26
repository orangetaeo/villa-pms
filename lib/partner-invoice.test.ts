import { describe, expect, it, vi } from "vitest";
import { PartnerInvoiceStatus, ReceivableStatus } from "@prisma/client";
import {
  InvoiceError,
  computeInvoiceTotal,
  generateInvoiceForPeriod,
  invoiceStatusAfterPayment,
  issueInvoice,
  receivableBalance,
  recordInvoicePayment,
  voidInvoice,
} from "./partner-invoice";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("receivableBalance / computeInvoiceTotal", () => {
  it("잔금 = 총액 − 선금 − 잔금입금", () => {
    expect(
      receivableBalance({ totalVnd: 1_000_000n, depositPaidVnd: 300_000n, balancePaidVnd: 0n })
    ).toBe(700_000n);
  });
  it("과입금이어도 음수 0", () => {
    expect(
      receivableBalance({ totalVnd: 1_000_000n, depositPaidVnd: 700_000n, balancePaidVnd: 700_000n })
    ).toBe(0n);
  });
  it("청구 총액 = 채권 잔금 합계(선금 차감 후)", () => {
    expect(
      computeInvoiceTotal([
        { totalVnd: 1_000_000n, depositPaidVnd: 300_000n, balancePaidVnd: 0n }, // 700k
        { totalVnd: 2_000_000n, depositPaidVnd: 600_000n, balancePaidVnd: 0n }, // 1.4M
      ])
    ).toBe(2_100_000n);
  });
});

describe("invoiceStatusAfterPayment", () => {
  it("완납 → PAID", () => {
    expect(invoiceStatusAfterPayment(1_000_000n, 1_000_000n)).toBe(PartnerInvoiceStatus.PAID);
  });
  it("일부 → PARTIAL", () => {
    expect(invoiceStatusAfterPayment(1_000_000n, 400_000n)).toBe(PartnerInvoiceStatus.PARTIAL);
  });
  it("0 → ISSUED 유지", () => {
    expect(invoiceStatusAfterPayment(1_000_000n, 0n)).toBe(PartnerInvoiceStatus.ISSUED);
  });
});

// ── tx mock ──
function makeTx(opts: {
  dup?: { id: string } | null;
  candidates?: Array<{ id: string; totalVnd: bigint; depositPaidVnd: bigint; balancePaidVnd: bigint }>;
  invoice?: unknown;
}) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "inv-new",
    paidVnd: 0n,
    ...data,
  }));
  const invUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "inv1",
    ...data,
  }));
  const rcvUpdateMany = vi.fn(async () => ({ count: (opts.candidates ?? []).length }));
  const rcvUpdate = vi.fn(async () => ({}));
  // findUnique: generate(dup 체크)는 {id}|null, record/issue/void는 invoice 객체
  const invFindUnique = vi.fn(async () =>
    opts.invoice !== undefined ? opts.invoice : (opts.dup ?? null)
  );
  const tx = {
    partnerInvoice: { findUnique: invFindUnique, create, update: invUpdate },
    partnerReceivable: {
      findMany: vi.fn(async () => opts.candidates ?? []),
      updateMany: rcvUpdateMany,
      update: rcvUpdate,
    },
  };
  return { tx: tx as never, create, invUpdate, rcvUpdateMany, rcvUpdate };
}

describe("generateInvoiceForPeriod", () => {
  const period = { partnerId: "p1", periodStart: utc("2026-07-01"), periodEnd: utc("2026-07-31"), paymentTermDays: 30 };

  it("이미 같은 기간 청구서 존재 → PERIOD_EXISTS", async () => {
    const { tx } = makeTx({ dup: { id: "exist" } });
    await expect(generateInvoiceForPeriod(tx, period)).rejects.toMatchObject({ reason: "PERIOD_EXISTS" });
  });

  it("청구 대상 채권 0건 → NO_RECEIVABLES", async () => {
    const { tx } = makeTx({ dup: null, candidates: [] });
    await expect(generateInvoiceForPeriod(tx, period)).rejects.toBeInstanceOf(InvoiceError);
  });

  it("잔금>0 채권만 묶어 총액=잔금합·기한=마감+termDays, 채권 연결", async () => {
    const { tx, create, rcvUpdateMany } = makeTx({
      dup: null,
      candidates: [
        { id: "r1", totalVnd: 1_000_000n, depositPaidVnd: 300_000n, balancePaidVnd: 0n }, // 700k
        { id: "r2", totalVnd: 500_000n, depositPaidVnd: 500_000n, balancePaidVnd: 0n }, // 0 → 제외
        { id: "r3", totalVnd: 2_000_000n, depositPaidVnd: 600_000n, balancePaidVnd: 0n }, // 1.4M
      ],
    });
    const { receivableCount } = await generateInvoiceForPeriod(tx, period);
    expect(receivableCount).toBe(2); // r2 제외
    const data = create.mock.calls[0]![0].data;
    expect(data.totalVnd).toBe(2_100_000n);
    expect((data.dueDate as Date).toISOString()).toBe("2026-08-30T00:00:00.000Z");
    expect(data.status).toBe(PartnerInvoiceStatus.DRAFT);
    // r1·r3만 연결 (r2 제외)
    expect(rcvUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["r1", "r3"] } },
      data: { invoiceId: "inv-new" },
    });
  });
});

describe("issueInvoice", () => {
  it("DRAFT → ISSUED", async () => {
    const { tx, invUpdate } = makeTx({ invoice: { id: "inv1", status: PartnerInvoiceStatus.DRAFT } });
    await issueInvoice(tx, "inv1", utc("2026-08-01"));
    expect(invUpdate).toHaveBeenCalledWith({
      where: { id: "inv1" },
      data: { status: PartnerInvoiceStatus.ISSUED, issuedAt: utc("2026-08-01") },
    });
  });
  it("이미 발행된 건 → INVALID_STATUS", async () => {
    const { tx } = makeTx({ invoice: { id: "inv1", status: PartnerInvoiceStatus.ISSUED } });
    await expect(issueInvoice(tx, "inv1", utc("2026-08-01"))).rejects.toMatchObject({
      reason: "INVALID_STATUS",
    });
  });
});

describe("recordInvoicePayment", () => {
  it("일부 입금 → PARTIAL, 채권 미정산", async () => {
    const { tx, invUpdate, rcvUpdate } = makeTx({
      invoice: {
        id: "inv1",
        status: PartnerInvoiceStatus.ISSUED,
        totalVnd: 1_000_000n,
        paidVnd: 0n,
        receivables: [{ id: "r1", totalVnd: 1_000_000n, depositPaidVnd: 300_000n }],
      },
    });
    await recordInvoicePayment(tx, { invoiceId: "inv1", amountVnd: 400_000n, now: utc("2026-08-10") });
    expect(invUpdate.mock.calls[0]![0].data).toMatchObject({
      paidVnd: 400_000n,
      status: PartnerInvoiceStatus.PARTIAL,
      paidAt: null,
    });
    expect(rcvUpdate).not.toHaveBeenCalled();
  });

  it("완납 → PAID + 묶인 채권 PAID·잔금 0", async () => {
    const { tx, invUpdate, rcvUpdate } = makeTx({
      invoice: {
        id: "inv1",
        status: PartnerInvoiceStatus.ISSUED,
        totalVnd: 700_000n,
        paidVnd: 0n,
        receivables: [{ id: "r1", totalVnd: 1_000_000n, depositPaidVnd: 300_000n }],
      },
    });
    await recordInvoicePayment(tx, { invoiceId: "inv1", amountVnd: 700_000n, now: utc("2026-08-10") });
    expect(invUpdate.mock.calls[0]![0].data).toMatchObject({
      status: PartnerInvoiceStatus.PAID,
      paidAt: utc("2026-08-10"),
    });
    // 채권 r1: balancePaid = total(1M) − deposit(300k) = 700k, status PAID
    expect(rcvUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { balancePaidVnd: 700_000n, status: ReceivableStatus.PAID },
    });
  });

  it("DRAFT 청구서엔 수납 불가 → INVALID_STATUS", async () => {
    const { tx } = makeTx({
      invoice: { id: "inv1", status: PartnerInvoiceStatus.DRAFT, totalVnd: 1n, paidVnd: 0n, receivables: [] },
    });
    await expect(
      recordInvoicePayment(tx, { invoiceId: "inv1", amountVnd: 1n, now: utc("2026-08-10") })
    ).rejects.toMatchObject({ reason: "INVALID_STATUS" });
  });
});

describe("voidInvoice", () => {
  it("완납 청구서 → INVALID_STATUS", async () => {
    const { tx } = makeTx({ invoice: { id: "inv1", status: PartnerInvoiceStatus.PAID } });
    await expect(voidInvoice(tx, "inv1")).rejects.toMatchObject({ reason: "INVALID_STATUS" });
  });
  it("VOID + 묶인 채권 연결 해제(재청구 가능)", async () => {
    const { tx, rcvUpdateMany, invUpdate } = makeTx({
      invoice: { id: "inv1", status: PartnerInvoiceStatus.ISSUED },
    });
    await voidInvoice(tx, "inv1");
    expect(rcvUpdateMany).toHaveBeenCalledWith({ where: { invoiceId: "inv1" }, data: { invoiceId: null } });
    expect(invUpdate.mock.calls[0]![0].data).toEqual({ status: PartnerInvoiceStatus.VOID });
  });
});
