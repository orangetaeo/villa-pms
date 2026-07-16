// POST /api/webchat/sessions/[id]/reply — 운영자 답장(ko) (T-webchat-mvp)
//
// ADMIN 전용(첫 줄 role 검사). ownerAdminId 스코프 강제. CLOSED/BLOCKED면 409.
// 발송 직전 방문자 언어로 1회 번역 — 실패해도 ko 원문 발송 + translationFailed=true(발송 누락 금지).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability, notFoundIfMissing } from "@/lib/api-guard";
import { publish } from "@/lib/realtime-bus";
import { maybeTranslate, computeExpiresAt, previewText, MSG_MAX_LEN } from "@/lib/webchat";

const schema = z.object({ text: z.string() });

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
  const text = parsed.data.text;
  const trimmed = text.trim();
  if (trimmed.length === 0 || text.length > MSG_MAX_LEN) {
    return NextResponse.json({ error: "INVALID_LENGTH" }, { status: 400 });
  }

  // 소유 스코프 강제 — 타 운영자 세션은 404
  const session = await prisma.webChatSession.findFirst({
    where: { id, ownerAdminId: g.userId },
    select: { id: true, status: true, visitorLocale: true, ownerAdminId: true },
  });
  const found = notFoundIfMissing(session);
  if (!found.ok) return found.response;
  const s = found.resource;

  // 종료·차단 세션엔 발송 불가
  if (s.status === "CLOSED" || s.status === "BLOCKED") {
    return NextResponse.json({ error: "SESSION_NOT_OPEN", status: s.status }, { status: 409 });
  }

  // 발송 직전 번역(ko → 방문자 언어). 일일캡 카운트 포함. 실패해도 발송(플래그만).
  const tr = await maybeTranslate(text, s.visitorLocale, "ko");
  const translationFailed = tr.failed;

  const now = new Date();
  const expiresAt = computeExpiresAt(now);
  const preview = previewText(text);

  const message = await prisma.$transaction(async (tx) => {
    const m = await tx.webChatMessage.create({
      data: {
        sessionId: s.id,
        direction: "OUTBOUND",
        text, // ko 원문
        sourceLocale: "ko",
        translatedText: tr.translatedText,
        translatedTo: tr.translatedTo,
        translationFailed,
        sentBy: g.userId,
      },
      select: { id: true, createdAt: true },
    });
    await tx.webChatSession.update({
      where: { id: s.id },
      data: {
        lastMessageText: preview,
        lastMessageDirection: "OUTBOUND",
        lastMessageAt: m.createdAt,
        expiresAt, // 슬라이딩 연장(운영자 응답으로도 세션 유지)
        // unreadForAdmin은 증가하지 않음(운영자 자신의 발신)
      },
    });
    return m;
  });

  // 실시간 신호(식별만) — best-effort
  try {
    publish(s.ownerAdminId, { type: "outbound", conversationId: s.id, source: "webchat" });
  } catch {
    /* 신호 실패는 무해 */
  }

  // 감사 로그 — 운영자 발신 기록
  await writeAuditLog({
    userId: g.userId,
    action: "CREATE",
    entity: "WebChatMessage",
    entityId: message.id,
    changes: {
      sessionId: { new: s.id },
      direction: { new: "OUTBOUND" },
      translationFailed: { new: translationFailed },
    },
  });

  return NextResponse.json({
    ok: true,
    message: {
      id: message.id,
      createdAt: message.createdAt.toISOString(),
      translationFailed,
    },
  });
}
