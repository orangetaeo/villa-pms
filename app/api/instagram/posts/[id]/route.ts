// PATCH /api/instagram/posts/[id] — 초안 편집(caption·scheduledAt·kind). admin.
// 권한(첫 줄): isOperator만. 편집 허용 상태 = PENDING_APPROVAL·QUEUED만(발행 후는 API 수정 불가 — 인스타 정책).
// 캡션 수정 시 금칙어 재검사 → flaggedTerms 갱신. writeAuditLog 필수.
import { NextResponse } from "next/server";
import { z } from "zod";
import { IgPostKind, IgPostStatus, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit-log";
import { findBannedTerms } from "@/lib/instagram/caption";
import { serializeIgPost } from "@/lib/instagram/serialize";

const EDITABLE_STATUSES = new Set<IgPostStatus>([IgPostStatus.PENDING_APPROVAL, IgPostStatus.QUEUED]);

const patchSchema = z
  .object({
    caption: z.string().trim().min(1).max(2200).optional(), // 인스타 캡션 상한 2200자
    scheduledAt: z.string().datetime().optional(),
    kind: z.nativeEnum(IgPostKind).optional(),
  })
  .refine((d) => d.caption !== undefined || d.scheduledAt !== undefined || d.kind !== undefined, {
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

  const existing = await prisma.instagramPost.findUnique({
    where: { id },
    select: { id: true, status: true, caption: true, scheduledAt: true, kind: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!EDITABLE_STATUSES.has(existing.status)) {
    return NextResponse.json({ error: "NOT_EDITABLE", status: existing.status }, { status: 409 });
  }

  const data: Prisma.InstagramPostUpdateInput = {};
  const changes: Record<string, { old?: unknown; new?: unknown }> = {};

  if (parsed.data.caption !== undefined && parsed.data.caption !== existing.caption) {
    data.caption = parsed.data.caption;
    changes.caption = { old: existing.caption.slice(0, 40), new: parsed.data.caption.slice(0, 40) };
    // 캡션 변경 시 금칙어 재검사.
    const flagged = findBannedTerms(parsed.data.caption);
    data.flaggedTerms = flagged.length > 0 ? flagged : Prisma.DbNull;
    changes.flaggedTerms = { new: flagged };
  }
  if (parsed.data.scheduledAt !== undefined) {
    const dt = new Date(parsed.data.scheduledAt);
    data.scheduledAt = dt;
    changes.scheduledAt = { old: existing.scheduledAt.toISOString(), new: dt.toISOString() };
  }
  if (parsed.data.kind !== undefined && parsed.data.kind !== existing.kind) {
    data.kind = parsed.data.kind;
    changes.kind = { old: existing.kind, new: parsed.data.kind };
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "NO_CHANGES" }, { status: 400 });
  }

  const updated = await prisma.instagramPost.update({
    where: { id },
    data,
    include: { villa: { select: { name: true } } },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "InstagramPost",
    entityId: id,
    changes,
  });

  return NextResponse.json({ post: serializeIgPost(updated) });
}
