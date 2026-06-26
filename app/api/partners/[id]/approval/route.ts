// /api/partners/[id]/approval — 파트너 자가가입 승인/거절 (ADR-0028 PP4)
//   PATCH: canSetPrice(OWNER/MANAGER). APPROVE → APPROVED+approvedAt. REJECT → REJECTED+rejectionReason.
//   승인된 파트너만 포털 로그인이 활성화됨(게이트는 파트너 로그인/포털 라우트에서 강제).
//   원천 공급자(/api/vendors/[id]/approval) 승인 흐름을 그대로 미러.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canSetPrice, type Role } from "@/lib/permissions";

const patchSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  rejectionReason: z.string().max(500).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!canSetPrice(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const partner = await prisma.partner.findUnique({
    where: { id },
    select: { id: true, approvalStatus: true },
  });
  if (!partner) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const updated = await prisma.partner.update({
    where: { id },
    data:
      d.action === "APPROVE"
        ? { approvalStatus: "APPROVED", approvedAt: now, rejectionReason: null }
        : { approvalStatus: "REJECTED", rejectionReason: d.rejectionReason ?? null },
    select: { id: true, approvalStatus: true },
  });

  await writeAuditLog({
    db: prisma,
    userId: session.user.id,
    action: "UPDATE",
    entity: "Partner",
    entityId: id,
    changes: {
      approvalStatus: { old: partner.approvalStatus, new: updated.approvalStatus },
      ...(d.action === "REJECT" ? { rejectionReason: { new: d.rejectionReason ?? null } } : {}),
    },
  });

  return NextResponse.json({ id: updated.id, approvalStatus: updated.approvalStatus });
}
