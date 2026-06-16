// PATCH /api/zalo/conversations/[id] — ADMIN 대화 읽음 처리 (T6.6, b14)
// 대화 열람 시 unreadCount=0. 멱등(이미 0이어도 200). 읽음은 운영 메타라 AuditLog 미기록.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({ action: z.literal("MARK_READ") });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }

  // updateMany — 멱등 + 미존재 대화는 count 0 → 404
  const result = await prisma.zaloConversation.updateMany({
    where: { id },
    data: { unreadCount: 0 },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, unreadCount: 0 });
}
