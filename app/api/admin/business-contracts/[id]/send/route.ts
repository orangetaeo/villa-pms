// POST /api/admin/business-contracts/[id]/send — DRAFT → SENT(서명 요청 발송). canViewFinance.
//   원자 전이(where status:DRAFT) — 이미 SENT/SIGNED/VOID면 409.
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  const actorId = g.userId;
  const { id } = await params;

  const contract = await prisma.businessContract.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!contract) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (contract.status !== "DRAFT") {
    return NextResponse.json({ error: "NOT_DRAFT", status: contract.status }, { status: 409 });
  }

  // 원자 전이 — 동시 send 레이스 가드.
  const res = await prisma.businessContract.updateMany({
    where: { id, status: "DRAFT" },
    data: { status: "SENT", sentAt: new Date() },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "NOT_DRAFT" }, { status: 409 });
  }

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "BusinessContract",
    entityId: id,
    changes: { status: { old: "DRAFT", new: "SENT" } },
  });

  return NextResponse.json({ ok: true });
}
