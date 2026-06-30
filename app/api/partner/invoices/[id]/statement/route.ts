// /api/partner/invoices/[id]/statement — 파트너 본인 청구서 PDF 다운로드 (여행사 포털 A)
//
// GET: requireAuth + Role=PARTNER + 본인 partnerId 청구서만(IDOR 차단). 미생성 시 온디맨드 생성.
//   관리자 GET(/api/partner-invoices/[id]/statement)의 파트너 미러 — 동일 PDF(화이트리스트: 기간·총액·
//   수납액·기한만, 신용한도·마진·KRW 미포함, 생성기가 보장). DRAFT/VOID는 미발행이라 거부.
//   private,no-store(파트너 비공개 자료) + 경로 주입 가드(결정형 파일명).
import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { getPartnerForUser } from "@/lib/partner-auth";
import { getInvoiceDir, invoiceFileName } from "@/lib/storage";
import { generateInvoiceStatement } from "@/lib/partner-invoice-statement-service";

export const runtime = "nodejs"; // react-pdf·fs — edge 불가

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  if (g.session.user.role !== "PARTNER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // 본인 partnerId 스코프 — 미연결/미승인은 비노출
  const partner = await getPartnerForUser(g.session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  // ★ IDOR 차단: id + partnerId 동시 일치만 조회. 타 파트너 청구서는 NOT_FOUND.
  const inv = await prisma.partnerInvoice.findFirst({
    where: { id, partnerId: partner.id },
    select: { id: true, status: true, statementUrl: true },
  });
  if (!inv) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // DRAFT/VOID는 파트너에게 발행된 청구서가 아님 — 다운로드 불가
  if (inv.status === "DRAFT" || inv.status === "VOID") {
    return NextResponse.json({ error: "NOT_AVAILABLE" }, { status: 409 });
  }

  // 미생성 시 온디맨드 생성(actorId=파트너 userId, AuditLog에 파트너 생성으로 기록).
  let statementUrl = inv.statementUrl;
  if (!statementUrl) {
    statementUrl = await generateInvoiceStatement(inv.id, g.session.user.id);
    if (!statementUrl) {
      return NextResponse.json({ error: "NOT_GENERATED" }, { status: 404 });
    }
  }

  // 경로 주입 방지 — 저장 파일명은 결정형, 저장값이 그와 다르면 거부
  const expected = invoiceFileName(inv.id);
  if (statementUrl !== expected) {
    return NextResponse.json({ error: "INVALID_FILE" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(path.join(getInvoiceDir(), expected));
  } catch {
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="hoa-don-${expected}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
