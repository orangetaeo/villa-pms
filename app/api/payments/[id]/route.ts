// app/api/payments/[id] — 결제 1건 삭제 (정산 2차 P2-1, 오기록 정정용)
//
// ★ ADMIN(canViewFinance) 전용. writeAuditLog(DELETE) 기록.
// 계약: docs/contracts/T-settlement-payment-recording.md
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { reverseCollection } from "@/lib/ledger";
import { reversePaymentFromReceivable } from "@/lib/partner-booking";

/** DELETE — 결제 기록 삭제 (ADMIN 전용) */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(canViewFinance, "canViewFinance", _req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id },
      select: {
        id: true,
        bookingId: true,
        currency: true,
        amount: true,
        invoiceId: true,
        // 채권 카운터 되돌림용 (ADR-0022)
        purpose: true,
        vndEquivalent: true,
        receivableId: true,
      },
    });
    if (!payment) return { kind: "NOT_FOUND" as const };
    // 청구서 수납 결제(invoiceId)는 이 경로로 삭제 금지 — paidVnd·채권 상태가 어긋남.
    // 청구서 수납 정정은 별도 흐름(ADR-0027 D3, 후속). 여기선 예약 직접수납만.
    if (payment.invoiceId) return { kind: "INVOICE_LINKED" as const };

    // ★파트너 객실료 입금(DEPOSIT/BALANCE) 삭제면 채권 선금/잔금 카운터도 되돌린다.
    //   안 하면 receivable.depositPaidVnd가 과대 → 여신게이트·채권상태가 어긋남(reverseInvoicePayment와 대칭).
    //   LEDGER(reverseCollection)는 현금주의 분개만 되돌리고, 채권 카운터(운영 테이블)는 별도이므로 이중반영 아님.
    if (
      payment.receivableId &&
      (payment.purpose === "DEPOSIT" || payment.purpose === "BALANCE")
    ) {
      // 동시 입금(POST)과의 lost-update 차단 — 같은 booking 채권 락(payments POST와 동일 키).
      if (payment.bookingId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`receivable:${payment.bookingId}`}))`;
      }
      const rcv = await tx.partnerReceivable.findUnique({
        where: { id: payment.receivableId },
        select: { totalVnd: true, depositPaidVnd: true, balancePaidVnd: true },
      });
      if (rcv) {
        const reverted = reversePaymentFromReceivable(
          rcv,
          payment.purpose,
          payment.vndEquivalent ?? 0n
        );
        await tx.partnerReceivable.update({
          where: { id: payment.receivableId },
          data: reverted,
        });
      }
    }

    await tx.payment.delete({ where: { id } });
    // 복식부기 LEDGER — COLLECTION 분개 역분개(정정). 분개선은 cascade 삭제 (ADR-0018)
    await reverseCollection(tx, id);
    await writeAuditLog({
      userId: session.user.id,
      action: "DELETE",
      entity: "Payment",
      entityId: id,
      changes: {
        bookingId: { old: payment.bookingId, new: null },
        amount: { old: `${payment.currency} ${payment.amount}`, new: null },
      },
      db: tx,
    });
    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "INVOICE_LINKED") {
    return NextResponse.json({ error: "INVOICE_PAYMENT_NO_DIRECT_DELETE" }, { status: 409 });
  }
  return NextResponse.json({ id, deleted: true });
}
