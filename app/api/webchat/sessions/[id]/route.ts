// GET /api/webchat/sessions/[id] — 운영자 세션 상세 + 메시지 전체 (T-webchat-mvp)
//
// ADMIN 전용(첫 줄 role 검사). ownerAdminId 스코프 강제(타 운영자 세션 404). 열람 시 unreadForAdmin=0 리셋.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability, notFoundIfMissing } from "@/lib/api-guard";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 첫 줄 role 검사 — ADMIN 전용
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  // 소유 스코프 강제 — 타 운영자 세션은 404(존재 비노출)
  const session = await prisma.webChatSession.findFirst({
    where: { id, ownerAdminId: g.userId },
    select: {
      id: true,
      visitorLocale: true,
      status: true,
      sourcePage: true,
      contactEmail: true,
      contactZalo: true,
      contactKakao: true,
      unreadForAdmin: true,
      lastMessageAt: true,
      createdAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          direction: true,
          text: true,
          sourceLocale: true,
          translatedText: true,
          translatedTo: true,
          translationFailed: true,
          status: true,
          sentBy: true,
          createdAt: true,
        },
      },
    },
  });
  const found = notFoundIfMissing(session);
  if (!found.ok) return found.response;
  const s = found.resource;

  // 열람 시 미확인 리셋(totalUnread 정확도). 이미 0이면 무해.
  if (s.unreadForAdmin > 0) {
    await prisma.webChatSession.update({
      where: { id: s.id },
      data: { unreadForAdmin: 0 },
    });
  }

  return NextResponse.json({
    session: {
      id: s.id,
      visitorLocale: s.visitorLocale,
      status: s.status,
      sourcePage: s.sourcePage,
      contactEmail: s.contactEmail,
      contactZalo: s.contactZalo,
      contactKakao: s.contactKakao,
      unreadForAdmin: 0,
      lastMessageAt: s.lastMessageAt ? s.lastMessageAt.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
      messages: s.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        text: m.text,
        sourceLocale: m.sourceLocale,
        translatedText: m.translatedText,
        translatedTo: m.translatedTo,
        translationFailed: m.translationFailed,
        status: m.status,
        sentBy: m.sentBy,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  });
}
