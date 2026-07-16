// POST /api/instagram/posts/[id]/approve — 초안 승인 PENDING_APPROVAL → QUEUED. admin.
// 권한(첫 줄): isOperator만. 짝 액션 가드: where에 기대 상태(PENDING_APPROVAL) 포함(대칭).
//   승인되면 발행 cron이 scheduledAt 도래 시 발행한다.
import { NextResponse } from "next/server";
import { IgPostStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;

  // 원자 전이 — PENDING_APPROVAL만 QUEUED로. 0건이면 이미 승인/반려/발행됨.
  const res = await prisma.instagramPost.updateMany({
    where: { id, status: IgPostStatus.PENDING_APPROVAL },
    data: { status: IgPostStatus.QUEUED },
  });
  if (res.count === 0) {
    const exists = await prisma.instagramPost.findUnique({ where: { id }, select: { status: true } });
    if (!exists) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ error: "INVALID_STATE", status: exists.status }, { status: 409 });
  }

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "InstagramPost",
    entityId: id,
    changes: { status: { old: "PENDING_APPROVAL", new: "QUEUED" } },
  });

  return NextResponse.json({ ok: true, status: IgPostStatus.QUEUED });
}
