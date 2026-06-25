// app/api/payments/[id] — 결제 1건 삭제 (정산 2차 P2-1, 오기록 정정용)
//
// ★ ADMIN(canViewFinance) 전용. writeAuditLog(DELETE) 기록.
// 계약: docs/contracts/T-settlement-payment-recording.md
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";

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
      select: { id: true, bookingId: true, currency: true, amount: true },
    });
    if (!payment) return { kind: "NOT_FOUND" as const };

    await tx.payment.delete({ where: { id } });
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
  return NextResponse.json({ id, deleted: true });
}
