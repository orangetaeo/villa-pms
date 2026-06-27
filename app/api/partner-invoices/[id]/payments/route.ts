// POST /api/partner-invoices/[id]/payments — 청구서 수납 기록 (ADR-0022 PARTNER-3b)
// canViewFinance 전용. paidVnd 누적 + 상태 재계산, 완납 시 묶인 채권 PAID 정산(서비스 계층).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { serializeBigInt } from "@/lib/serialize";
import { InvoiceError, recordInvoicePayment } from "@/lib/partner-invoice";

const schema = z.object({
  // VND 동 단위 정수(문자열/숫자)
  amountVnd: z
    .union([z.string().regex(/^\d+$/), z.number().int().positive()])
    .transform((v) => BigInt(v)),
  receivedAt: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });

  const now = parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : new Date();
  try {
    const updated = await prisma.$transaction((tx) =>
      recordInvoicePayment(tx, {
        invoiceId: id,
        amountVnd: parsed.data.amountVnd,
        now,
        createdBy: session.user.id,
      })
    );
    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE",
      entity: "PartnerInvoice",
      entityId: id,
      changes: {
        invoicePayment: { new: `VND ${parsed.data.amountVnd}` },
        status: { new: updated.status },
      },
    });
    return NextResponse.json(serializeBigInt(updated), { status: 201 });
  } catch (e) {
    if (e instanceof InvoiceError) {
      const status = e.reason === "NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: e.reason, message: e.message }, { status });
    }
    console.error("[partner-invoices/payments] 수납 실패", e);
    return NextResponse.json({ error: "수납 처리에 실패했습니다" }, { status: 500 });
  }
}

/** GET — 청구서 수납 내역(개별 Payment) 목록 (ADMIN 전용, ADR-0027 D3). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id } = await params;
  const payments = await prisma.payment.findMany({
    where: { invoiceId: id },
    select: { id: true, amount: true, currency: true, receivedAt: true, method: true },
    orderBy: { receivedAt: "asc" },
  });
  return NextResponse.json({ payments: serializeBigInt(payments) });
}
