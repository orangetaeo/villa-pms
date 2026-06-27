// /api/settlements/[id]/statement — 월 정산서 PDF 생성·서빙 (정산 2차 P2-4)
//
// POST: 정산서 PDF 생성·비공개 저장·statementUrl 갱신 (ADMIN, canViewFinance).
// GET : PDF 서빙 — 게이트 = ADMIN(canViewFinance) 또는 그 정산의 소유 공급자(supplierId===user.id).
//       정산서엔 공급자 원가가 있어 비공개. private,no-store. 마진·판매가·KRW 미포함(생성기 보장).
// 계약: docs/contracts/T-settlement-statement-pdf-p2-4.md
import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { getStatementDir, statementFileName } from "@/lib/storage";
import { generateSettlementStatement } from "@/lib/settlement-statement-service";

export const runtime = "nodejs"; // react-pdf·fs — edge 불가

/** POST — 정산서 생성·저장 (ADMIN 전용) */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(canViewFinance, "canViewFinance", _req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;
  const fileName = await generateSettlementStatement(id, session.user.id);
  if (!fileName) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ statementUrl: fileName });
}

/** GET — 정산서 PDF 서빙 (ADMIN 또는 소유 공급자) */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id } = await params;
  const s = await prisma.settlement.findUnique({
    where: { id },
    select: { supplierId: true, statementUrl: true, yearMonth: true },
  });
  if (!s) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // 게이트: ADMIN(재무권한) 또는 그 정산의 소유 공급자만
  const isFinance = canViewFinance(session.user.role);
  const isOwner = session.user.id === s.supplierId;
  if (!isFinance && !isOwner) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (!s.statementUrl) {
    return NextResponse.json({ error: "NOT_GENERATED" }, { status: 404 });
  }

  // 경로 주입 방지 — 저장 파일명은 결정형, 저장값이 그와 다르면 거부
  const expected = statementFileName(id);
  if (s.statementUrl !== expected) {
    return NextResponse.json({ error: "INVALID_FILE" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(path.join(getStatementDir(), expected));
  } catch {
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quyet-toan-${s.yearMonth}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
