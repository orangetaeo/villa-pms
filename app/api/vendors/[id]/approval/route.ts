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
  const nextStatus = d.action === "APPROVE" ? "APPROVED" : "REJECTED";
  // ★동시성 가드 — 읽은 approvalStatus 위에서만 전이 반영(다른 상태전이 라우트와 동일 패턴).
  //   승인/반려 방향은 현행대로 읽은 상태에서 무조건 허용하되, 읽기~쓰기 사이 다른 요청이
  //   상태를 바꿨으면 count!==1 → 409로 막아 이중 처리(중복 감사로그)를 차단한다.
  const updated = await prisma.serviceVendor.updateMany({
    where: { id, approvalStatus: vendor.approvalStatus },
    data:
      d.action === "APPROVE"
        ? { approvalStatus: "APPROVED", approvedAt: now, rejectionReason: null }
        : { approvalStatus: "REJECTED", rejectionReason: d.rejectionReason ?? null },
  });
  if (updated.count !== 1) {
    return NextResponse.json({ error: "CONCURRENT_MODIFICATION" }, { status: 409 });
  }

  await writeAuditLog({
    db: prisma,
    userId: session.user.id,
    action: "UPDATE",
    entity: "ServiceVendor",
    entityId: id,
    changes: {
      approvalStatus: { old: vendor.approvalStatus, new: nextStatus },
      ...(d.action === "REJECT" ? { rejectionReason: { new: d.rejectionReason ?? null } } : {}),
    },
  });

  return NextResponse.json({ id, approvalStatus: nextStatus });
}
