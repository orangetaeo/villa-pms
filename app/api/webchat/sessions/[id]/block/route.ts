// POST /api/webchat/sessions/[id]/block — 운영자 차단/해제 토글 (T-webchat-mvp, BLOCKED 5종 ①)
//
// ADMIN 전용(첫 줄 role 검사). ownerAdminId 스코프 강제. blocked=true→BLOCKED, false→OPEN. +AuditLog.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability, notFoundIfMissing } from "@/lib/api-guard";

const schema = z.object({ blocked: z.boolean() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 첫 줄 role 검사 — ADMIN 전용
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }

  // 소유 스코프 강제 — 타 운영자 세션은 404
  const session = await prisma.webChatSession.findFirst({
    where: { id, ownerAdminId: g.userId },
    select: { id: true, status: true },
  });
  const found = notFoundIfMissing(session);
  if (!found.ok) return found.response;
  const s = found.resource;

  const nextStatus = parsed.data.blocked ? "BLOCKED" : "OPEN";
  await prisma.webChatSession.update({
    where: { id: s.id },
    data: { status: nextStatus },
  });

  // 감사 로그 — 차단/해제 기록
  await writeAuditLog({
    userId: g.userId,
    action: "UPDATE",
    entity: "WebChatSession",
    entityId: s.id,
    changes: { status: { old: s.status, new: nextStatus } },
  });

  return NextResponse.json({ ok: true, status: nextStatus });
}
