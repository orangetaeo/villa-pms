// POST /api/partner-invoices/[id]/send — 마감 청구서 Zalo 발송 (PARTNER-3b-UI)
//
// partner.contactZaloUid로 청구서 PDF 첨부 + 본문(vi) 직접 발송(시스템 봇). 알림 큐(User 기반)가
// 아닌 직접 발송 — 파트너는 User가 아니라 contactZaloUid를 직접 보유. 첨부 실패 시 텍스트 폴백.
// ADMIN(canViewFinance) 전용. 본문엔 **한도·마진·판매가 미포함**(누수 가드).
// 계약: docs/contracts/PARTNER-3b-UI.md
import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { fmtVnd } from "@/lib/settlement-statement";
import { toDateOnlyString } from "@/lib/date-vn";
import { getInvoiceDir, invoiceFileName } from "@/lib/storage";
import {
  generateInvoiceStatement,
  invoiceDisplayNo,
} from "@/lib/partner-invoice-statement-service";
import {
  sendBotMessage,
  sendBotMessageWithAttachments,
  type BotAttachment,
} from "@/lib/zalo-runtime";

export const runtime = "nodejs"; // react-pdf·fs — edge 불가

const dot = (d: Date) => toDateOnlyString(d).replaceAll("-", ".");

/** 청구서 Zalo 본문 (vi) — 화이트리스트 필드만(한도·마진 미노출) */
function buildInvoiceText(inv: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  totalVnd: bigint;
  paidVnd: bigint;
}): string {
  const outstanding = inv.totalVnd - inv.paidVnd;
  const lines = [
    "🧾 Villa Go — HÓA ĐƠN THANH TOÁN",
    `Số hóa đơn: ${invoiceDisplayNo(inv.id)}`,
    `Kỳ: ${dot(inv.periodStart)} ~ ${dot(inv.periodEnd)}`,
    `Tổng tiền: ${fmtVnd(inv.totalVnd)}`,
  ];
  if (inv.paidVnd > 0n) {
    lines.push(`Đã thanh toán: ${fmtVnd(inv.paidVnd)}`);
    lines.push(`Còn lại: ${fmtVnd(outstanding > 0n ? outstanding : 0n)}`);
  }
  lines.push(`⏰ Hạn thanh toán: ${dot(inv.dueDate)}`);
  lines.push("Xem chi tiết trong file đính kèm. Cảm ơn quý đối tác!");
  return lines.join("\n");
}

/** 첨부 해석 — 비공개 파일 읽기, 미생성이면 온디맨드 생성 후 재읽기. 실패 시 null(텍스트 폴백). */
async function resolveAttachment(
  invoiceId: string,
  actorId: string
): Promise<BotAttachment | null> {
  try {
    const filePath = path.join(getInvoiceDir(), invoiceFileName(invoiceId));
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      const saved = await generateInvoiceStatement(invoiceId, actorId);
      if (!saved) return null;
      buffer = await fs.readFile(filePath);
    }
    return {
      data: buffer,
      filename: `hoa-don-${invoiceDisplayNo(invoiceId)}.pdf`,
      totalSize: buffer.length,
    };
  } catch {
    return null;
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const inv = await prisma.partnerInvoice.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      dueDate: true,
      totalVnd: true,
      paidVnd: true,
      partner: { select: { contactZaloUid: true } },
    },
  });
  if (!inv) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // DRAFT·VOID는 발송 불가 (미발행/무효 청구서)
  if (inv.status === "DRAFT" || inv.status === "VOID") {
    return NextResponse.json({ error: "INVALID_STATUS" }, { status: 409 });
  }
  const zaloUid = inv.partner.contactZaloUid?.trim();
  if (!zaloUid) {
    return NextResponse.json({ error: "NO_ZALO_LINK" }, { status: 422 });
  }

  const text = buildInvoiceText(inv);
  const attachment = await resolveAttachment(id, session.user.id);
  const result = attachment
    ? await sendBotMessageWithAttachments(zaloUid, text, [attachment])
    : await sendBotMessage(zaloUid, text);

  if (!result.ok) {
    // 봇 미연결 등 — 발송 실패(크래시 금지, 상태 변경 없음)
    return NextResponse.json({ error: "SEND_FAILED", detail: result.error }, { status: 502 });
  }

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "PartnerInvoice",
    entityId: id,
    changes: {
      zaloSent: { new: zaloUid },
      withAttachment: { new: attachment != null },
    },
  });

  return NextResponse.json({ ok: true, withAttachment: attachment != null });
}
