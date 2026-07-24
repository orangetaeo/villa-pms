// GET /api/webchat/sessions/[id] — 운영자 세션 상세 + 메시지 전체 (T-webchat-mvp)
//
// ADMIN 전용(첫 줄 role 검사). ownerAdminId 스코프 강제(타 운영자 세션 404). 열람 시 unreadForAdmin=0 리셋.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { requireCapability, notFoundIfMissing } from "@/lib/api-guard";
import { isWebChatCardKind, parseWebChatCardPayload } from "@/lib/webchat-card";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 첫 줄 role 검사 — 운영자 전체(OWNER/MANAGER/STAFF/ADMIN). 웹챗은 구조적 무금액이라 STAFF 개방 안전.
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  // 웹챗 세션은 조직 공유 자산 — Zalo 대화(개인 스코프)와 다름 (T-webchat-expand)
  const session = await prisma.webChatSession.findFirst({
    where: { id },
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
      // 세션↔예약 연결(운영자 전용 — 방문자 폴링 응답엔 절대 미포함). ★금액 필드 select 배제.
      bookingId: true,
      booking: {
        select: {
          id: true,
          guestName: true,
          checkIn: true,
          checkOut: true,
          status: true,
          villa: { select: { name: true } },
        },
      },
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
          // 카드 렌더용(링크 발송 메시지) — payload는 url·표시값만.
          kind: true,
          payload: true,
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
      // 세션↔예약 연결 요약(미연결이면 둘 다 null). ★금액 무관 표시 전용.
      bookingId: s.bookingId ?? null,
      booking: s.booking
        ? {
            bookingId: s.booking.id,
            guestName: s.booking.guestName,
            villaName: s.booking.villa?.name ?? null,
            checkIn: s.booking.checkIn.toISOString(),
            checkOut: s.booking.checkOut.toISOString(),
            status: s.booking.status,
          }
        : null,
      messages: s.messages.map((m) => {
        const card = isWebChatCardKind(m.kind) ? parseWebChatCardPayload(m.payload, m.kind) : null;
        return {
          id: m.id,
          direction: m.direction,
          text: m.text,
          sourceLocale: m.sourceLocale,
          translatedText: m.translatedText,
          translatedTo: m.translatedTo,
          translationFailed: m.translationFailed,
          status: m.status,
          sentBy: m.sentBy,
          // 카드가 유효할 때만 노출(구 메시지·일반 대화=null → 텍스트 렌더).
          kind: card ? m.kind : null,
          payload: card,
          createdAt: m.createdAt.toISOString(),
        };
      }),
    },
  });
}
