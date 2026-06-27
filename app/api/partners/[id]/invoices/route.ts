// POST /api/partners/[id]/invoices — 마감 청구서 생성(잔금만·누적, ADR-0022 PARTNER-3b)
// GET  /api/partners/[id]/invoices — 파트너 청구서 목록
// canViewFinance 전용. 미수·청구액은 재무 전용(누수 가드).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { serializeBigInt } from "@/lib/serialize";
import { generateInvoiceForPeriod, InvoiceError } from "@/lib/partner-invoice";

const utcDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

const createSchema = z
  .object({
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
  })
  .refine((d) => d.periodStart <= d.periodEnd, { message: "기간이 올바르지 않습니다" });

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
  const invoices = await prisma.partnerInvoice.findMany({
    where: { partnerId: id },
    orderBy: { periodEnd: "desc" },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      dueDate: true,
      totalVnd: true,
      paidVnd: true,
      status: true,
      statementUrl: true,
      issuedAt: true,
      paidAt: true,
      _count: { select: { receivables: true } },
    },
  });
  return NextResponse.json({ invoices: serializeBigInt(invoices) });
}

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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }

  const partner = await prisma.partner.findUnique({
    where: { id },
    select: { id: true, paymentTermDays: true },
  });
  if (!partner) return NextResponse.json({ error: "PARTNER_NOT_FOUND" }, { status: 404 });

  try {
    const { invoice, receivableCount } = await prisma.$transaction((tx) =>
      generateInvoiceForPeriod(tx, {
        partnerId: id,
        periodStart: utcDate(parsed.data.periodStart),
        periodEnd: utcDate(parsed.data.periodEnd),
        paymentTermDays: partner.paymentTermDays,
      })
    );
    await writeAuditLog({
      userId: session.user.id,
      action: "CREATE",
      entity: "PartnerInvoice",
      entityId: invoice.id,
      changes: {
        partnerId: { new: id },
        period: { new: `${parsed.data.periodStart}~${parsed.data.periodEnd}` },
        totalVnd: { new: invoice.totalVnd.toString() },
        receivableCount: { new: receivableCount },
      },
    });
    return NextResponse.json(serializeBigInt(invoice), { status: 201 });
  } catch (e) {
    if (e instanceof InvoiceError) {
      // PERIOD_EXISTS=409, NO_RECEIVABLES=422(생성할 잔금 없음)
      const status = e.reason === "NO_RECEIVABLES" ? 422 : 409;
      return NextResponse.json({ error: e.reason }, { status });
    }
    console.error("[partners/invoices] 생성 실패", e);
    return NextResponse.json({ error: "청구서 생성에 실패했습니다" }, { status: 500 });
  }
}
