// PATCH /api/partner-invoices/[id] — 청구서 발행/무효 (ADR-0022 PARTNER-3b)
// canViewFinance 전용. action=issue(DRAFT→ISSUED) | void(→VOID·채권 연결해제).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { serializeBigInt } from "@/lib/serialize";
import {
  InvoiceError,
  invoiceDisplayNo,
  issueInvoice,
  voidInvoice,
} from "@/lib/partner-invoice";
import { notifyPartner } from "@/lib/partner-notify";
import { toDateOnlyString } from "@/lib/date-vn";

const schema = z.object({ action: z.enum(["issue", "void"]) });

export async function PATCH(
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

  try {
    const now = new Date();
    const updated = await prisma.$transaction((tx) =>
      parsed.data.action === "issue" ? issueInvoice(tx, id, now) : voidInvoice(tx, id)
    );
    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE",
      entity: "PartnerInvoice",
      entityId: id,
      changes: { action: { new: parsed.data.action }, status: { new: updated.status } },
    });

    // 발행 시 파트너에게 인앱+Zalo 통지 (T-partner-workflow-gaps ①) — 커밋 후, 실패해도 발행 응답 무해.
    if (parsed.data.action === "issue") {
      try {
        await notifyPartner(updated.partnerId, {
          kind: "INVOICE_ISSUED",
          invoiceId: updated.id,
          invoiceNo: invoiceDisplayNo(updated.id),
          dueDate: toDateOnlyString(updated.dueDate),
          totalVnd: updated.totalVnd.toString(),
        });
      } catch (notifyErr) {
        console.warn("[partner-invoices] 발행 통지 실패(발행은 완료)", notifyErr);
      }
    }

    return NextResponse.json(serializeBigInt(updated));
  } catch (e) {
    if (e instanceof InvoiceError) {
      const status = e.reason === "NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: e.reason, message: e.message }, { status });
    }
    console.error("[partner-invoices] 전이 실패", e);
    return NextResponse.json({ error: "처리에 실패했습니다" }, { status: 500 });
  }
}
