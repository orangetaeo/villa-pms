// PATCH /api/youtube/shorts/[id] — 초안 편집(title·description·scheduledAt). admin.
// 권한(첫 줄): isOperator만. 편집 허용 상태 = PENDING_APPROVAL·QUEUED만(그 외 409 — 업로드 후 API 수정 불가).
// title/description 수정 시 금칙어 재검사 → flaggedTerms 갱신. title 100자 가드. writeAuditLog 필수.
import { NextResponse } from "next/server";
import { z } from "zod";
import { YtShortStatus, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { findBannedTerms } from "@/lib/instagram/caption";
import { serializeYtShort } from "@/lib/youtube/serialize";
import { YT_TITLE_MAX } from "@/lib/youtube/meta";

const EDITABLE_STATUSES = new Set<YtShortStatus>([YtShortStatus.PENDING_APPROVAL, YtShortStatus.QUEUED]);

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(YT_TITLE_MAX).optional(), // YouTube 제목 상한 100자
    description: z.string().trim().max(5000).optional(),
    scheduledAt: z.string().datetime().optional(),
  })
  .refine((d) => d.title !== undefined || d.description !== undefined || d.scheduledAt !== undefined, {
    message: "변경할 필드가 없습니다",
  });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

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

  const existing = await prisma.youtubeShort.findUnique({
    where: { id },
    select: { id: true, status: true, title: true, description: true, scheduledAt: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!EDITABLE_STATUSES.has(existing.status)) {
    return NextResponse.json({ error: "NOT_EDITABLE", status: existing.status }, { status: 409 });
  }

  const data: Prisma.YoutubeShortUpdateInput = {};
  const changes: Record<string, { old?: unknown; new?: unknown }> = {};

  const nextTitle = parsed.data.title ?? existing.title;
  const nextDescription = parsed.data.description ?? existing.description;
  let textChanged = false;

  if (parsed.data.title !== undefined && parsed.data.title !== existing.title) {
    data.title = parsed.data.title;
    changes.title = { old: existing.title.slice(0, 40), new: parsed.data.title.slice(0, 40) };
    textChanged = true;
  }
  if (parsed.data.description !== undefined && parsed.data.description !== existing.description) {
    data.description = parsed.data.description;
    changes.description = { old: existing.description.slice(0, 40), new: parsed.data.description.slice(0, 40) };
    textChanged = true;
  }
  // 제목·설명 중 하나라도 바뀌면 결합 텍스트로 금칙어 재검사.
  if (textChanged) {
    const flagged = findBannedTerms(`${nextTitle}\n${nextDescription}`);
    data.flaggedTerms = flagged.length > 0 ? flagged : Prisma.DbNull;
    changes.flaggedTerms = { new: flagged };
  }
  if (parsed.data.scheduledAt !== undefined) {
    const dt = new Date(parsed.data.scheduledAt);
    data.scheduledAt = dt;
    changes.scheduledAt = { old: existing.scheduledAt.toISOString(), new: dt.toISOString() };
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "NO_CHANGES" }, { status: 400 });
  }

  const updated = await prisma.youtubeShort.update({
    where: { id },
    data,
    include: { villa: { select: { name: true } } },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "YoutubeShort",
    entityId: id,
    changes,
  });

  return NextResponse.json({ short: serializeYtShort(updated) });
}
