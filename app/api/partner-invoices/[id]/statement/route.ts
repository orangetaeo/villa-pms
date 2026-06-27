// /api/partner-invoices/[id]/statement — 마감 청구서 PDF 생성·서빙 (PARTNER-3b-UI)
//
// POST: 청구서 PDF 생성·비공개 저장·statementUrl 갱신 (ADMIN, canViewFinance).
// GET : PDF 서빙 — 게이트 = ADMIN(canViewFinance) 전용. 파트너는 로그인 없음(Zalo로 수령).
//       청구서엔 객실료 잔금이 있어 비공개. private,no-store. 한도·마진·KRW 미포함(생성기 보장).
// 계약: docs/contracts/PARTNER-3b-UI.md
import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { getInvoiceDir, invoiceFileName } from "@/lib/storage";
import { generateInvoiceStatement } from "@/lib/partner-invoice-statement-service";

export const runtime = "nodejs"; // react-pdf·fs — edge 불가

/** POST — 청구서 PDF 생성·저장 (ADMIN 전용) */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(canViewFinance, "canViewFinance", _req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;
  const fileName = await generateInvoiceStatement(id, session.user.id);
  if (!fileName) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ statementUrl: fileName });
}

/** GET — 청구서 PDF 서빙 (ADMIN 전용) */
export async function GET(
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
    select: { statementUrl: true },
  });
  if (!inv) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!inv.statementUrl) {
    return NextResponse.json({ error: "NOT_GENERATED" }, { status: 404 });
  }

  // 경로 주입 방지 — 저장 파일명은 결정형, 저장값이 그와 다르면 거부
  const expected = invoiceFileName(id);
  if (inv.statementUrl !== expected) {
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
