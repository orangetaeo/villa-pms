// POST /api/admin/business-contracts/[id]/void — 어떤 상태든(SIGNED 포함) → VOID(재계약 개방). canViewFinance.
//   서명본은 봉인(수정 금지)이지만 VOID는 허용 — 무효화 후 신규 계약 생성 가능.
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
  if (contract.status === "VOID") {
    return NextResponse.json({ ok: true, alreadyVoid: true });
  }

  await prisma.businessContract.update({
    where: { id },
    data: { status: "VOID" },
  });

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "BusinessContract",
    entityId: id,
    changes: { status: { old: contract.status, new: "VOID" } },
  });

  return NextResponse.json({ ok: true });
}
