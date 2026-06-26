// app/api/payments/[id] — 결제 1건 삭제 (정산 2차 P2-1, 오기록 정정용)
//
// ★ ADMIN(canViewFinance) 전용. writeAuditLog(DELETE) 기록.
// 계약: docs/contracts/T-settlement-payment-recording.md
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { reverseCollection } from "@/lib/ledger";

/** DELETE — 결제 기록 삭제 (ADMIN 전용) */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id },
      select: { id: true, bookingId: true, currency: true, amount: true, invoiceId: true },
    });
    if (!payment) return { kind: "NOT_FOUND" as const };
    // 청구서 수납 결제(invoiceId)는 이 경로로 삭제 금지 — paidVnd·채권 상태가 어긋남.
    // 청구서 수납 정정은 별도 흐름(ADR-0027 D3, 후속). 여기선 예약 직접수납만.
    if (payment.invoiceId) return { kind: "INVOICE_LINKED" as const };

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
