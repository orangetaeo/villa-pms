// /api/vendors/[id]/approval — 원천 공급자 자가가입 승인/거절 (ADR-0023 S5)
//   PATCH: canSetPrice(OWNER/MANAGER). APPROVE → APPROVED+approvedAt. REJECT → REJECTED+rejectionReason.
//   승인된 공급자만 카탈로그 배정·발주 수신 가능(게이트는 catalog·dispatch 라우트에서 강제).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canSetPrice } from "@/lib/permissions";

const patchSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  rejectionReason: z.string().max(500).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const session = g.session;
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

  const vendor = await prisma.serviceVendor.findUnique({
    where: { id },
    select: { id: true, approvalStatus: true },
  });
  if (!vendor) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = new Date();
  const updated = await prisma.serviceVendor.update({
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
    entity: "ServiceVendor",
    entityId: id,
    changes: {
      approvalStatus: { old: vendor.approvalStatus, new: updated.approvalStatus },
      ...(d.action === "REJECT" ? { rejectionReason: { new: d.rejectionReason ?? null } } : {}),
    },
  });

  return NextResponse.json({ id: updated.id, approvalStatus: updated.approvalStatus });
}
