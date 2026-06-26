import {
  Currency,
  PartnerInvoiceStatus,
  PaymentMethod,
  PaymentPurpose,
  ReceivableStatus,
  type Prisma,
} from "@prisma/client";
import { postCollection } from "@/lib/ledger";
import { writeAuditLog } from "@/lib/audit-log";

/**
 * 파트너 마감 청구서(PartnerInvoice) 서비스 (ADR-0022 PARTNER-3b).
 *
 * 테오 확정(2026-06-26):
 *  - 청구 금액 = **잔금만**(각 채권의 미입금 잔액 = 객실료 − 선금/중간입금). 선금 중복청구 없음.
 *  - 묶음 = **마감일까지 미청구 채권 전부(누적)**: invoiceId 없음 + dueDate ≤ periodEnd + 미완납.
 *
 * 등급 B(여신) 파트너의 주/15/30일 마감 정산 단위. 전부 ADMIN(canViewFinance) 전용.
 * ⚠️ 누수: 청구액·미수는 재무 경로에서만. PDF/Zalo 발송 본문에 한도·마진 직렬화 금지.
 */

type Tx = Prisma.TransactionClient;

/** 채권 1건의 미입금 잔액(잔금) = 총액 − 선금입금 − 잔금입금 (음수면 0) */
export function receivableBalance(r: {
  totalVnd: bigint;
  depositPaidVnd: bigint;
  balancePaidVnd: bigint;
}): bigint {
  const remaining = r.totalVnd - r.depositPaidVnd - r.balancePaidVnd;
  return remaining > 0n ? remaining : 0n;
}

/** 청구서 총액 = 묶인 채권들의 잔금 합계 (순수) */
export function computeInvoiceTotal(
  receivables: Array<{ totalVnd: bigint; depositPaidVnd: bigint; balancePaidVnd: bigint }>
): bigint {
  return receivables.reduce((sum, r) => sum + receivableBalance(r), 0n);
}

/** 입금 반영 후 청구서 상태(순수) — 완납=PAID, 일부=PARTIAL, 없음=현행 유지(ISSUED) */
export function invoiceStatusAfterPayment(
  totalVnd: bigint,
  paidVnd: bigint
): PartnerInvoiceStatus {
  if (totalVnd > 0n && paidVnd >= totalVnd) return PartnerInvoiceStatus.PAID;
  if (paidVnd > 0n) return PartnerInvoiceStatus.PARTIAL;
  return PartnerInvoiceStatus.ISSUED;
}

/** UTC 자정 기준 일수 가산 (@db.Date 규약) */
function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.trunc(days)));
  return d;
}

/** 마감 청구 대상 채권 상태 — 완납·대손·VOID 제외 */
const BILLABLE_STATUSES: ReceivableStatus[] = [
  ReceivableStatus.PENDING,
  ReceivableStatus.PARTIAL,
  ReceivableStatus.OVERDUE,
];

export class InvoiceError extends Error {
  constructor(
    public readonly reason:
      | "NO_RECEIVABLES"
      | "PERIOD_EXISTS"
      | "NOT_FOUND"
      | "INVALID_STATUS",
    detail?: string
  ) {
    super(detail ?? reason);
    this.name = "InvoiceError";
  }
}

/**
 * 마감 청구서 생성 — 파트너의 미청구 잔금 채권을 묶어 PartnerInvoice(DRAFT) 생성.
 *  - 대상: invoiceId 없음 + status∈billable + dueDate ≤ periodEnd + 잔금>0 (누적)
 *  - totalVnd = 잔금 합계, dueDate = periodEnd + paymentTermDays
 *  - 같은 (partnerId, periodStart, periodEnd) 청구서가 이미 있으면 PERIOD_EXISTS
 *  - 대상 채권 0건이면 NO_RECEIVABLES (throw)
 */
export async function generateInvoiceForPeriod(
  tx: Tx,
  input: {
    partnerId: string;
    periodStart: Date;
    periodEnd: Date;
    paymentTermDays: number;
  }
) {
  const dup = await tx.partnerInvoice.findUnique({
    where: {
      partnerId_periodStart_periodEnd: {
        partnerId: input.partnerId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    },
    select: { id: true },
  });
  if (dup) throw new InvoiceError("PERIOD_EXISTS");

  const candidates = await tx.partnerReceivable.findMany({
    where: {
      partnerId: input.partnerId,
      invoiceId: null,
      status: { in: BILLABLE_STATUSES },
      dueDate: { lte: input.periodEnd },
    },
    select: {
      id: true,
      totalVnd: true,
      depositPaidVnd: true,
      balancePaidVnd: true,
    },
  });
  const billable = candidates.filter((r) => receivableBalance(r) > 0n);
  if (billable.length === 0) throw new InvoiceError("NO_RECEIVABLES");

  const invoice = await tx.partnerInvoice.create({
    data: {
      partnerId: input.partnerId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueDate: addDaysUtc(input.periodEnd, input.paymentTermDays),
      totalVnd: computeInvoiceTotal(billable),
      status: PartnerInvoiceStatus.DRAFT,
    },
  });

  await tx.partnerReceivable.updateMany({
    where: { id: { in: billable.map((r) => r.id) } },
    data: { invoiceId: invoice.id },
  });

  return { invoice, receivableCount: billable.length };
}

/** 발행 — DRAFT → ISSUED (issuedAt 기록). DRAFT가 아니면 INVALID_STATUS */
export async function issueInvoice(tx: Tx, invoiceId: string, now: Date) {
  const inv = await tx.partnerInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true },
  });
  if (!inv) throw new InvoiceError("NOT_FOUND");
  if (inv.status !== PartnerInvoiceStatus.DRAFT) {
    throw new InvoiceError("INVALID_STATUS", `현재 상태: ${inv.status}`);
  }
  return tx.partnerInvoice.update({
    where: { id: invoiceId },
    data: { status: PartnerInvoiceStatus.ISSUED, issuedAt: now },
  });
}

/**
 * 청구서 수납 — paidVnd 누적 + 상태 재계산. 완납 시 묶인 채권을 PAID로 정산(잔금 0).
 * DRAFT·VOID에는 수납 불가(INVALID_STATUS).
 */
export async function recordInvoicePayment(
  tx: Tx,
  input: { invoiceId: string; amountVnd: bigint; now: Date; createdBy: string }
) {
  const inv = await tx.partnerInvoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
      partnerId: true,
      status: true,
      totalVnd: true,
      paidVnd: true,
      receivables: {
        select: { id: true, totalVnd: true, depositPaidVnd: true },
      },
    },
  });
  if (!inv) throw new InvoiceError("NOT_FOUND");
  if (
    inv.status === PartnerInvoiceStatus.DRAFT ||
    inv.status === PartnerInvoiceStatus.VOID
  ) {
    throw new InvoiceError("INVALID_STATUS", `현재 상태: ${inv.status}`);
  }

  const add = input.amountVnd > 0n ? input.amountVnd : 0n;
  const paidVnd = inv.paidVnd + add;
  const status = invoiceStatusAfterPayment(inv.totalVnd, paidVnd);

  const updated = await tx.partnerInvoice.update({
    where: { id: input.invoiceId },
    data: {
      paidVnd,
      status,
      paidAt: status === PartnerInvoiceStatus.PAID ? input.now : null,
    },
  });

  // 완납 시 묶인 채권 정산 — 잔금 0(balancePaid = total − deposit), 상태 PAID
  if (status === PartnerInvoiceStatus.PAID) {
    for (const r of inv.receivables) {
      const balance = r.totalVnd - r.depositPaidVnd;
      await tx.partnerReceivable.update({
        where: { id: r.id },
        data: {
          balancePaidVnd: balance > 0n ? balance : 0n,
          status: ReceivableStatus.PAID,
        },
      });
    }
  }

  // 복식부기 LEDGER — 청구서로 들어온 현금을 COLLECTION으로 적재 (ADR-0027).
  // 청구서는 VND 표시 → CASH_VND +add / REVENUE −add. 수납 이벤트당 Payment row 1건이
  // 멱등 앵커(paymentId @unique). 선금은 예약경로에서 이미 적재됐고 청구서 totalVnd는
  // 잔금만이므로 이중계상 없음. add=0(0원·음수 입력)이면 분개·Payment 미생성.
  // 과입금(amountVnd > 잔금)은 실입금 그대로 적재(상한 없음) — 회계는 실제 현금 기준.
  if (add > 0n) {
    const payment = await tx.payment.create({
      data: {
        currency: Currency.VND,
        amount: add,
        method: PaymentMethod.VN_BANK_TRANSFER,
        vndEquivalent: add,
        receivedAt: input.now,
        purpose: PaymentPurpose.BALANCE,
        partnerId: inv.partnerId,
        invoiceId: inv.id,
        // bookingId 없음 — 청구서는 여러 예약에 걸침(ADR-0027).
      },
    });
    await postCollection(tx, {
      paymentId: payment.id,
      currency: Currency.VND,
      amount: add,
      occurredAt: input.now,
      createdBy: input.createdBy,
      memo: `청구서 ${inv.id} 수납`,
    });
    // 감사 로그 — 새 Payment 엔티티 추적(예약 직접수납 경로와 일관, 글로벌 AuditLog 규칙).
    await writeAuditLog({
      userId: input.createdBy,
      action: "CREATE",
      entity: "Payment",
      entityId: payment.id,
      changes: {
        invoiceId: { old: null, new: inv.id },
        amount: { old: null, new: `VND ${add}` },
        purpose: { old: null, new: PaymentPurpose.BALANCE },
      },
      db: tx,
    });
  }

  return updated;
}

/** 무효화 — VOID + 묶인 채권 연결 해제(invoiceId null)로 재청구 가능. PAID는 불가 */
export async function voidInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.partnerInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true },
  });
  if (!inv) throw new InvoiceError("NOT_FOUND");
  if (inv.status === PartnerInvoiceStatus.PAID) {
    throw new InvoiceError("INVALID_STATUS", "완납 청구서는 무효화할 수 없습니다");
  }
  await tx.partnerReceivable.updateMany({
    where: { invoiceId },
    data: { invoiceId: null },
  });
  return tx.partnerInvoice.update({
    where: { id: invoiceId },
    data: { status: PartnerInvoiceStatus.VOID },
  });
}
