// lib/settlement-statement-service.ts — 정산 2차 P2-4: 정산서 생성·저장 서비스 (server).
//
// 정산 로드 → PDF 생성 → 비공개 저장 → statementUrl 갱신 + AuditLog. POST 라우트와
// MARK_PAID 훅이 공유. **판매가·마진·KRW는 select하지 않음**(누수 차단).
// 계약: docs/contracts/T-settlement-statement-pdf-p2-4.md
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { saveStatementFile } from "@/lib/storage";
import { generateStatementPdf } from "@/lib/settlement-statement-pdf";
import { toDateOnlyString, todayVnDateString } from "@/lib/date-vn";
import { formatVillaName } from "@/lib/villa-name";

/**
 * 정산서 PDF 생성·저장·statementUrl 갱신. 정산 없으면 null.
 * @returns 저장 파일명(statementUrl) 또는 null
 */
export async function generateSettlementStatement(
  settlementId: string,
  actorId: string
): Promise<string | null> {
  const s = await prisma.settlement.findUnique({
    where: { id: settlementId },
    select: {
      id: true,
      yearMonth: true,
      totalVnd: true,
      fxAdjustmentVnd: true,
      statementUrl: true,
      supplier: { select: { name: true } },
      items: {
        select: {
          amountVnd: true,
          booking: {
            select: {
              checkOut: true,
              nights: true,
              villa: { select: { name: true, nameVi: true } },
            },
          },
        },
      },
    },
  });
  if (!s) return null;

  // 체크아웃 오름차순 정렬 후 표시 라인 구성
  const lines = s.items
    .map((it) => ({
      villaName: formatVillaName({
        name: it.booking.villa.name,
        nameVi: it.booking.villa.nameVi,
      }),
      checkOutRaw: it.booking.checkOut,
      checkOut: toDateOnlyString(it.booking.checkOut).replaceAll("-", "."),
      nights: it.booking.nights,
      amountVnd: it.amountVnd,
    }))
    .sort((a, b) => a.checkOutRaw.getTime() - b.checkOutRaw.getTime())
    .map(({ checkOutRaw: _omit, ...l }) => l);

  const pdf = await generateStatementPdf({
    supplierName: s.supplier.name,
    yearMonth: s.yearMonth,
    issuedAt: todayVnDateString().replaceAll("-", "."),
    lines,
    totalVnd: s.totalVnd,
    fxAdjustmentVnd: s.fxAdjustmentVnd,
  });

  const { fileName } = await saveStatementFile(pdf, s.id);
  await prisma.$transaction(async (tx) => {
    await tx.settlement.update({
      where: { id: s.id },
      data: { statementUrl: fileName },
    });
    await writeAuditLog({
      db: tx,
      userId: actorId,
      action: "UPDATE",
      entity: "Settlement",
      entityId: s.id,
      changes: { statementUrl: { old: s.statementUrl, new: fileName } },
    });
  });
  return fileName;
}
