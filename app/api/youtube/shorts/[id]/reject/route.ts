// POST /api/youtube/shorts/[id]/reject — 초안 반려 (PENDING_APPROVAL·QUEUED) → CANCELLED. admin.
// 권한(첫 줄): isOperator만. 짝 액션 가드: where에 반려 가능 상태 포함(대칭). 사유(reason) 옵션.
import { NextResponse } from "next/server";
import { z } from "zod";
import { YtShortStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";

const REJECTABLE = [YtShortStatus.PENDING_APPROVAL, YtShortStatus.QUEUED];

const bodySchema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;

  let reason: string | undefined;
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    if (parsed.success) reason = parsed.data.reason;
  } catch {
    /* 사유 없는 반려 허용 */
  }

  const res = await prisma.youtubeShort.updateMany({
    where: { id, status: { in: REJECTABLE } },
    data: { status: YtShortStatus.CANCELLED, failReason: reason ?? null },
  });
  if (res.count === 0) {
    const exists = await prisma.youtubeShort.findUnique({ where: { id }, select: { status: true } });
    if (!exists) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ error: "INVALID_STATE", status: exists.status }, { status: 409 });
  }

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "YoutubeShort",
    entityId: id,
    changes: { status: { new: "CANCELLED" }, reason: { new: reason ?? null } },
  });

  return NextResponse.json({ ok: true, status: YtShortStatus.CANCELLED });
}
