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
import { partnerInvoiceLocale, type InvoiceLocale } from "@/lib/partner-country";
import { toDateOnlyString, todayVnDateString } from "@/lib/date-vn";

const dot = (d: Date) => toDateOnlyString(d).replaceAll("-", ".");

/** 청구서 표시번호 — ID 끝 6자리 대문자 (문서/Zalo 공용) */
export function invoiceDisplayNo(invoiceId: string): string {
  return `INV-${invoiceId.slice(-6).toUpperCase()}`;
}

/**
 * 파트너 표시명 — 언어별 결정.
 * - vi 문서: nameVi 우선·name 폴백 (베트남 거래처 가독)
 * - ko/en 문서: name(원문) 우선 — 한글 글리프는 PDF에서 NanumGothic로 정상 렌더되므로 토푸 회피 불필요
 */
export function partnerDisplayName(
  p: { name: string; nameVi: string | null },
  locale: InvoiceLocale = "vi"
): string {
  if (locale === "vi") return p.nameVi?.trim() || p.name;
  return p.name || p.nameVi?.trim() || "";
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
      partner: { select: { name: true, nameVi: true, country: true } },
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

  // 출력 언어 — 파트너 국가로 자동 결정(KR=ko·VN=vi·그 외=en, 미지정=vi)
  const locale = partnerInvoiceLocale(inv.partner.country);

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
    partnerName: partnerDisplayName(inv.partner, locale),
    invoiceNo: invoiceDisplayNo(inv.id),
    periodStart: dot(inv.periodStart),
    periodEnd: dot(inv.periodEnd),
    dueDate: dot(inv.dueDate),
    issuedAt: todayVnDateString().replaceAll("-", "."),
    lines,
    paidVnd: inv.paidVnd,
    locale,
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
