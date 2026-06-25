// /api/settlements/ledger-verify — 복식부기 LEDGER 무결성 검증 (정산 2차 P2-3, ADR-0018)
//
// ★ ADMIN(canViewFinance) 전용 — 계정잔액·매출·환차는 공급자에 절대 노출 금지(leak-checklist).
// 통화별 회계항등식(합 0) + SUPPLIER_PAYABLE 잔액 = 미지급 정산 합 교차검증.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { verifyLedger } from "@/lib/ledger";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const result = await verifyLedger(prisma);
  return NextResponse.json(result);
}
