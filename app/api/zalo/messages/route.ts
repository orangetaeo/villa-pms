// POST /api/zalo/messages — ADMIN 수동 채팅 발신 (T6.6, b14, ADR-0003)
// 흐름: ZaloMessage(OUTBOUND·CHAT) 영속 → sendBotMessage 시도 → status SENT/FAILED 갱신
//       → conversation.lastMessageAt 갱신 → AuditLog
// 발송 실패(봇 미연결·타임아웃·API 오류)는 status=FAILED로 기록하되 500 금지 — 영속은 200.
// 마진·판매가·KRW 절대 미포함 (사업 원칙 2).
// ADR-0006 D5.5: 개인계정(zca-js)은 48h CS 제약 없음 → isReplyWindowOpen 가드 제거(입력창 항상 활성).
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
} from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { sendChatMessageAsAdmin } from "@/lib/zalo-runtime";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().trim().min(1).max(4000),
});

export async function POST(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { conversationId, text } = parsed.data;

  // 소유 검증 — 본인(ownerAdminId) 대화에만 발신 (ADR-0007 D3.4, 타 관리자 대화 발신 차단).
  const conversation = await prisma.zaloConversation.findFirst({
    where: { id: conversationId, ownerAdminId: session.user.id },
    select: { id: true, zaloUserId: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 1) 발송 시도 — 본인 계정으로 발신. 봇 미연결/실패는 status=FAILED 기록(500 금지). 48h 가드 없음(D5.5).
  let status: ZaloMessageStatus;
  let error: string | null = null;
  let zaloMsgId: string | null = null;

  const result = await sendChatMessageAsAdmin(
    session.user.id,
    conversation.zaloUserId,
    text
  );
  if (result.ok) {
    status = ZaloMessageStatus.SENT;
    zaloMsgId = result.messageId;
  } else {
    status = ZaloMessageStatus.FAILED;
    error = result.error;
  }

  // 2) 영속 + lastMessageAt 갱신 + AuditLog (원자적)
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.zaloMessage.create({
      data: {
        conversationId,
        direction: ZaloMessageDirection.OUTBOUND,
        source: ZaloMessageSource.CHAT,
        msgType: "text",
        text,
        zaloMsgId,
        status,
        error,
        sentBy: session.user.id,
      },
      select: { id: true, status: true, createdAt: true },
    });

    await tx.zaloConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    });

    // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙). 본문 텍스트는 기록하지 않음.
    await writeAuditLog({
      userId: session.user.id,
      action: "CREATE",
      entity: "ZaloMessage",
      entityId: created.id,
      changes: {
        direction: { new: "OUTBOUND" },
        source: { new: "CHAT" },
        status: { new: status },
      },
      db: tx,
    });

    return created;
  });

  return NextResponse.json({
    id: message.id,
    status: message.status,
    error,
    createdAt: message.createdAt.toISOString(),
  });
}
