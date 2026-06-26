// lib/partner-invoice-statement-service.ts — PARTNER-3b-UI: 청구서 PDF 생성·저장 서비스 (server).
//
// 청구서 로드 → PDF 생성 → 비공개 저장 → statementUrl 갱신 + AuditLog. POST 라우트와
// Zalo 발송이 공유. **신용한도·마진·판매가(KRW)는 select하지 않음**(누수 차단).
// 계약: docs/contracts/PARTNER-3b-UI.md
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { saveInvoiceFile } from "@/lib/storage";
import { generateInvoicePdf } from "@/lib/partner-invoice-pdf";
import { receivableBalance } from "@/lib/partner-invoice";
import { toDateOnlyString, todayVnDateString } from "@/lib/date-vn";

const dot = (d: Date) => toDateOnlyString(d).replaceAll("-", ".");

/** 청구서 표시번호 — ID 끝 6자리 대문자 (문서/Zalo 공용) */
export function invoiceDisplayNo(invoiceId: string): string {
  return `INV-${invoiceId.slice(-6).toUpperCase()}`;
}

/** 파트너 표시명 — vi 대상 문서라 nameVi 우선·name 폴백 (한글 토푸 회피) */
export function partnerDisplayName(p: { name: string; nameVi: string | null }): string {
  return p.nameVi?.trim() || p.name;
}

/**
 * 청구서 PDF 생성·저장·statementUrl 갱신. 청구서/묶인 채권 없으면 null.
 * @returns 저장 파일명(statementUrl) 또는 null
 */
export async function generateInvoiceStatement(
  invoiceId: string,
  actorId: string
): Promise<string | null> {
  const inv = await prisma.partnerInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      dueDate: true,
      paidVnd: true,
      statementUrl: true,
      partner: { select: { name: true, nameVi: true } },
      receivables: {
        select: {
          totalVnd: true,
          depositPaidVnd: true,
          balancePaidVnd: true,
          booking: {
            select: {
              checkIn: true,
              checkOut: true,
              nights: true,
              villa: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!inv || inv.receivables.length === 0) return null;

  const lines = inv.receivables
    .map((r) => ({
      villaName: r.booking.villa.name,
      checkInRaw: r.booking.checkIn,
      stay: `${dot(r.booking.checkIn)} ~ ${dot(r.booking.checkOut)}`,
      nights: r.booking.nights,
      amountVnd: receivableBalance(r),
    }))
    .sort((a, b) => a.checkInRaw.getTime() - b.checkInRaw.getTime())
    .map(({ checkInRaw: _omit, ...l }) => l);

  const pdf = await generateInvoicePdf({
    partnerName: partnerDisplayName(inv.partner),
    invoiceNo: invoiceDisplayNo(inv.id),
    periodStart: dot(inv.periodStart),
    periodEnd: dot(inv.periodEnd),
    dueDate: dot(inv.dueDate),
    issuedAt: todayVnDateString().replaceAll("-", "."),
    lines,
    paidVnd: inv.paidVnd,
  });

  const { fileName } = await saveInvoiceFile(pdf, inv.id);
  await prisma.$transaction(async (tx) => {
    await tx.partnerInvoice.update({
      where: { id: inv.id },
      data: { statementUrl: fileName },
    });
    await writeAuditLog({
      db: tx,
      userId: actorId,
      action: "UPDATE",
      entity: "PartnerInvoice",
      entityId: inv.id,
      changes: { statementUrl: { old: inv.statementUrl, new: fileName } },
    });
  });
  return fileName;
}
