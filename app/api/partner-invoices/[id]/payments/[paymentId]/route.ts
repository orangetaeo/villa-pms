// DELETE /api/partner-invoices/[id]/payments/[paymentId] — 청구서 수납 정정(취소) (ADR-0027 D3)
// canViewFinance 전용. Payment 삭제 + COLLECTION 역분개 + paidVnd 차감·상태 재계산
// + 완납 해제 시 묶인 채권 원복. 서비스 계층(reverseInvoicePayment)이 트랜잭션으로 처리.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { InvoiceError, reverseInvoicePayment } from "@/lib/partner-invoice";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id, paymentId } = await params;

  try {
    const updated = await prisma.$transaction((tx) =>
      reverseInvoicePayment(tx, {
        invoiceId: id,
        paymentId,
        createdBy: session.user.id,
      })
    );
    return NextResponse.json(serializeBigInt(updated));
  } catch (e) {
    if (e instanceof InvoiceError) {
      const status = e.reason === "NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: e.reason, message: e.message }, { status });
    }
    console.error("[partner-invoices/payments DELETE] 정정 실패", e);
    return NextResponse.json({ error: "수납 정정에 실패했습니다" }, { status: 500 });
  }
}
