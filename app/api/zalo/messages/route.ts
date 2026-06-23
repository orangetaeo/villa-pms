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
import { ThreadType } from "zca-js";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { translateText, previewTargetForMode, GeminiNotConfiguredError } from "@/lib/gemini";
import {
  sendChatMessageAsAdmin,
  sendChatReplyAsAdmin,
  getOwnIdForAdmin,
} from "@/lib/zalo-runtime";
import { isOperator } from "@/lib/permissions";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().trim().min(1).max(4000),
  // ADR-0009 R3-2 — 답글(인용). 지정 시 본인 대화의 ZaloMessage를 원본으로 인용해 발송.
  // 원본이 cliMsgId·zaloMsgId 미보유(과거 메시지)면 인용 불가 → 400.
  quotedMessageId: z.string().min(1).optional(),
  // 그룹 @멘션(선택) — 본문 "@이름" 토큰 위치·대상 uid(@all="-1"). zca-js 실제 멘션으로 발송.
  mentions: z
    .array(z.object({ pos: z.number().int().min(0), uid: z.string().min(1), len: z.number().int().min(1) }))
    .optional(),
});

export async function POST(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
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
  const { conversationId, text, quotedMessageId, mentions } = parsed.data;

  // 소유 검증 — 본인(ownerAdminId) 대화에만 발신 (ADR-0007 D3.4, 타 관리자 대화 발신 차단).
  const conversation = await prisma.zaloConversation.findFirst({
    where: { id: conversationId, ownerAdminId: session.user.id },
    select: { id: true, zaloUserId: true, translateMode: true, threadType: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // ADR-0010 S4 — 그룹 대화면 ThreadType.Group으로 발송(zaloUserId=그룹 id). 1:1은 USER.
  const sendThreadType =
    conversation.threadType === "GROUP" ? ThreadType.Group : ThreadType.User;

  // ── 답글(인용) 원본 조회 (ADR-0009 R3-2) — 지정 시만. 본인 대화의 메시지여야 함. ──
  let quoteSnapshot: {
    quotedMsgId: string | null;
    quotedText: string | null;
    quotedSender: string | null;
  } | null = null;
  let replyQuoteSource:
    | { zaloMsgId: string; cliMsgId: string; content: string; uidFrom: string }
    | null = null;
  if (quotedMessageId) {
    const original = await prisma.zaloMessage.findFirst({
      where: { id: quotedMessageId, conversation: { id: conversationId, ownerAdminId: session.user.id } },
      select: {
        zaloMsgId: true,
        cliMsgId: true,
        text: true,
        translatedText: true,
        direction: true,
        conversation: { select: { displayName: true, nickname: true } },
      },
    });
    if (!original) {
      return NextResponse.json({ error: "QUOTED_NOT_FOUND" }, { status: 404 });
    }
    // zca-js quote는 원본 msgId + cliMsgId 둘 다 요구 — 과거(미보유) 메시지는 인용 불가(R3-4).
    if (!original.zaloMsgId || !original.cliMsgId) {
      return NextResponse.json({ error: "QUOTE_NOT_SUPPORTED" }, { status: 400 });
    }
    // 인용 uidFrom — 원본이 내 발신(OUTBOUND)이면 내 ownId, 상대 발신(INBOUND)이면 대화 상대 zaloUserId.
    let uidFrom = conversation.zaloUserId;
    if (original.direction === ZaloMessageDirection.OUTBOUND) {
      uidFrom = (await getOwnIdForAdmin(session.user.id)) ?? conversation.zaloUserId;
    }
    const quotedSender =
      original.direction === ZaloMessageDirection.OUTBOUND
        ? null // 내 발신 인용 — 발신자 표시 생략(나)
        : original.conversation.nickname ?? original.conversation.displayName ?? null;
    quoteSnapshot = {
      quotedMsgId: original.zaloMsgId,
      quotedText: original.text,
      quotedSender,
    };
    replyQuoteSource = {
      zaloMsgId: original.zaloMsgId,
      cliMsgId: original.cliMsgId,
      // 인용 표시 본문 — 상대가 실제로 본 텍스트. 내 발신(OUTBOUND)은 발송된 번역문(있으면), 상대 발신은 원문.
      content:
        (original.direction === ZaloMessageDirection.OUTBOUND
          ? original.translatedText ?? original.text
          : original.text) ?? "",
      uidFrom,
    };
  }

  // 0) 발신 번역 (ADR-0009 D7 / 사용자 지시 2026-06-16) — VI/EN 모드면 번역문을 상대에게 발송하고
  //    원문 한국어는 내 기록용으로 보관(text). 번역 실패 시 한국어 오발송을 막기 위해 발송 중단.
  //    OFF 모드면 원문 그대로 발송(translatedText=null).
  let outboundText = text; // 실제 상대에게 가는 본문
  let translatedText: string | null = null; // 발송된 번역문(기록·OutboundBubble 표시)
  const target = previewTargetForMode(conversation.translateMode);
  if (target) {
    try {
      const translated = (await translateText(text, target)).trim();
      if (translated) {
        outboundText = translated;
        translatedText = translated;
      }
    } catch (err) {
      if (err instanceof GeminiNotConfiguredError) {
        return NextResponse.json({ error: "TRANSLATE_NOT_CONFIGURED" }, { status: 503 });
      }
      // 상태 코드만 — 본문 에코 방지(QA 권고). 한국어 오발송 방지 위해 미발송.
      return NextResponse.json({ error: "TRANSLATE_FAILED" }, { status: 502 });
    }
  }

  // 1) 발송 시도 — 본인 계정으로 발신. 봇 미연결/실패는 status=FAILED 기록(500 금지). 48h 가드 없음(D5.5).
  let status: ZaloMessageStatus;
  let error: string | null = null;
  let zaloMsgId: string | null = null;

  const result = replyQuoteSource
    ? await sendChatReplyAsAdmin(
        session.user.id,
        conversation.zaloUserId,
        outboundText,
        replyQuoteSource,
        sendThreadType,
        mentions
      )
    : await sendChatMessageAsAdmin(
        session.user.id,
        conversation.zaloUserId,
        outboundText,
        sendThreadType,
        mentions
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
        text, // 원문 한국어(내 기록용)
        translatedText, // 발송된 번역문(VI/EN 모드). OFF면 null
        zaloMsgId,
        status,
        error,
        sentBy: session.user.id,
        // 답글이면 인용 스냅샷 기록(자기 화면 표시 — R3-2). 일반 발신이면 null.
        quotedMsgId: quoteSnapshot?.quotedMsgId ?? null,
        quotedText: quoteSnapshot?.quotedText ?? null,
        quotedSender: quoteSnapshot?.quotedSender ?? null,
      },
      select: { id: true, status: true, createdAt: true, quotedText: true, quotedSender: true },
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
