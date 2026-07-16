// GET /api/instagram/dm/[threadId] — 스레드 대화 뷰 + 열람 시 읽음 처리 (admin, ko/다크)
// 권한(첫 줄): isOperator만. SUPPLIER/VENDOR/PARTNER 403.
// 동작: 스레드 메시지 시간순(asc) 반환 후, 미읽음 IN을 readByAdmin=true로 일괄 처리(열람 = 읽음).
// 반환(FE 소비 명세):
//   { threadId, senderName,
//     window: { lastInboundAt, expiresAt, expired },   // 답장 가능 창(마지막 IN + 24h)
//     messages: [{ id, direction, text, attachments, receivedAt, readByAdmin, autoReplied }] }
//   - 누수 없음: 가격 필드는 모델에 없음(명시적 화이트리스트 select).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGES = 200; // 대화 뷰 상한(messages-inbox-performance 교훈 — 클라 슬라이스 금지)

export async function GET(_req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { threadId } = await params;

  const rows = await prisma.instagramMessage.findMany({
    where: { igThreadId: threadId },
    orderBy: { receivedAt: "asc" },
    take: MAX_MESSAGES,
    select: {
      id: true,
      direction: true,
      text: true,
      attachments: true,
      receivedAt: true,
      readByAdmin: true,
      autoReplied: true,
      senderName: true,
    },
  });

  if (rows.length === 0) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 답장 가능 창 — 마지막 IN 기준(select 후 파생, 추가 쿼리 없음).
  const lastIn = [...rows].reverse().find((m) => m.direction === "IN") ?? null;
  const lastInAt = lastIn?.receivedAt ?? null;
  const window = {
    lastInboundAt: lastInAt ? lastInAt.toISOString() : null,
    expiresAt: lastInAt ? new Date(lastInAt.getTime() + WINDOW_MS).toISOString() : null,
    expired: !lastInAt || Date.now() - lastInAt.getTime() > WINDOW_MS,
  };

  // 상대 표시명(마지막 non-null senderName).
  const senderName = [...rows].reverse().find((m) => m.senderName)?.senderName ?? null;

  // 열람 = 읽음: 미읽음 IN 일괄 처리(응답 자체는 위 스냅샷 반환 — 방금 읽음이 UI에 즉시 반영되도록 표시 보정).
  await prisma.instagramMessage.updateMany({
    where: { igThreadId: threadId, direction: "IN", readByAdmin: false },
    data: { readByAdmin: true },
  });

  return NextResponse.json({
    threadId,
    senderName,
    window,
    messages: rows.map((m) => ({
      id: m.id,
      direction: m.direction,
      text: m.text,
      attachments: m.attachments ?? null,
      receivedAt: m.receivedAt.toISOString(),
      readByAdmin: m.direction === "IN" ? true : m.readByAdmin, // 방금 읽음 반영
      autoReplied: m.autoReplied,
    })),
  });
}
