// POST /api/zalo/ext/send — Nike→villa 발송 위임 엔드포인트 (S1 / ADR-0010 A1·A5)
//
// 목적: villa-pms가 테오 Zalo 세션의 단일 허브(ADR-0010 A안). Nike는 테오 계정을
//       더 이상 WebSocket 로그인하지 않고(B1), 발송을 이 서버-서버 엔드포인트로 위임한다(B2).
//       신규 발송 로직 작성 금지 — 기존 sendChat*AsAdmin / addReactionAsAdmin 재사용.
//
// 보안(A5):
//   - 시크릿 게이트: x-zalo-ext-secret 헤더 vs process.env.ZALO_EXT_SHARED_SECRET을
//     crypto.timingSafeEqual로 비교(단순 === 금지). 헤더 없음/불일치/env 미설정 → 401.
//     시크릿 값은 로그·응답·에러에 절대 미출력.
//   - ownerAdminId(테오)는 요청에서 절대 받지 않는다 — 서버에서 getSystemBotOwnerId()
//     (SYSTEM_BOT DB 동적 해석) 또는 env ZALO_SYSTEM_OWNER_ID로 결정. 리터럴 ID 인라인 금지.
//     결정 실패(SYSTEM_BOT 없음) → 503.
//   - 응답 DTO는 채팅 발송 결과(messageId 등 최소 필드)만. ZaloAccount.credentials·villa
//     마진/판매가/재고 모델 절대 미참조·미반환.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ThreadType } from "zca-js";
import {
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  sendChatMessageAsAdmin,
  sendChatImageAsAdmin,
  sendChatReplyAsAdmin,
  sendChatForwardAsAdmin,
  addReactionAsAdmin,
  REACTION_KEYS,
} from "@/lib/zalo-runtime";
import { isExtSecretValid, resolveSystemOwnerId } from "@/lib/zalo-ext-auth";

// ── threadId 정규화 (Nike→villa 발송 500 버그 수정 / ADR-0010) ─────────
//   Nike(B3 adaptVillaThread)는 A2 threads DTO의 `id`(villa 내부 cuid)를 대화 식별자로 받아
//   발송 시 threadId에 villa cuid를 보낸다. 그러나 zca-js는 threadId를 Zalo uid로 해석하므로
//   cuid를 그대로 보내면 SEND_ERROR(유효하지 않은 파라미터) → 502 → Nike POST 500.
//   해결: 발송 직전 threadId를 테오 스코프 conversation의 실제 zaloUserId로 정규화한다.
//   - cuid(=conversation.id)로 들어와도, 진짜 zaloUserId로 들어와도 모두 올바른 주소로 발송.
//   - 테오(ownerAdminId) 스코프 조건 필수 — 타 관리자 conversation 매칭 금지(누수 0 유지).
//   - 매칭 실패(conversation 없음)는 하위호환·방어로 threadId 그대로 사용(로그로 흔적).
//   ADR-0010 S4: 반환에 threadType도 포함 — GROUP 대화면 ThreadType.Group으로 발송한다.
async function resolveThreadZaloUserId(
  ownerAdminId: string,
  threadId: string
): Promise<{ zaloUserId: string; threadType: ThreadType; conversationId: string | null }> {
  const conv = await prisma.zaloConversation.findFirst({
    where: { ownerAdminId, OR: [{ id: threadId }, { zaloUserId: threadId }] },
    select: { id: true, zaloUserId: true, threadType: true },
  });
  if (conv?.zaloUserId) {
    return {
      zaloUserId: conv.zaloUserId,
      threadType: conv.threadType === "GROUP" ? ThreadType.Group : ThreadType.User,
      conversationId: conv.id,
    };
  }
  // 미존재 — 하위호환: threadId 그대로(방어). credential·시크릿 미노출, threadId만 흔적.
  console.warn(
    `[zalo/ext/send] threadId 정규화 실패(테오 스코프 conversation 없음) — threadId 그대로 발송: ${threadId}`
  );
  return { zaloUserId: threadId, threadType: ThreadType.User, conversationId: null };
}

/**
 * Nike 위임 발송(ko 원문 보유)을 villa 정본에 ko+vi로 저장 (2026-06-23).
 * Nike는 한국어로 입력 → 번역문(vi)을 Zalo로 보내는데, villa는 self-echo로 vi만 저장돼
 * 운영자 화면에 한국어 원문이 사라졌다. originalText(ko)가 오면 villa도 자체 발송과 동일하게
 * text=원문(ko)·translatedText=발송문(vi)으로 저장(OutboundBubble이 둘 다 표시).
 *
 * 멱등·레이스 안전: zaloMsgId 기준 upsert — self-echo(saveOutboundEcho)가 먼저/나중에 와도
 *   ① ext/send가 먼저면 create → echo는 zaloMsgId 존재로 skip.
 *   ② echo가 먼저(vi·translatedText=null)면 update로 text=ko·translatedText=vi 보강.
 * zaloMsgId 없으면(발송 응답에 msgId 부재) 키가 없어 echo에 위임(원문 없이 vi만 — 드묾).
 */
async function persistOutboundOriginal(
  conversationId: string,
  ownerAdminId: string,
  zaloMsgId: string | null,
  originalText: string,
  sentText: string
): Promise<void> {
  if (!zaloMsgId) return;
  try {
    await prisma.zaloMessage.upsert({
      where: { zaloMsgId },
      update: { text: originalText, translatedText: sentText },
      create: {
        conversationId,
        direction: ZaloMessageDirection.OUTBOUND,
        source: ZaloMessageSource.CHAT,
        msgType: "text",
        text: originalText,
        translatedText: sentText,
        zaloMsgId,
        status: ZaloMessageStatus.SENT,
        sentBy: ownerAdminId,
      },
    });
    await prisma.zaloConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
  } catch (err) {
    // 저장 실패가 발송 성공 응답을 막지 않도록 swallow(메시지는 이미 발송됨). 상태만 로그.
    console.error(
      "[zalo/ext/send] 원문 저장 실패(발송은 성공):",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── 본문 스키마 (discriminated union, kind 기준) ──────────────────────
// threadId = 발송 대상 Zalo userId(상대 스레드). ownerAdminId는 요청에서 받지 않음(서버 결정).
const replyQuoteSchema = z.object({
  zaloMsgId: z.string().min(1),
  cliMsgId: z.string().min(1),
  content: z.string().default(""),
  uidFrom: z.string().min(1),
});

// 그룹 @멘션 — 본문 내 "@이름" 토큰 위치·대상 uid(@all="-1"). villa가 zca-js 실제 멘션으로 전송.
const mentionSchema = z.array(
  z.object({ pos: z.number().int().min(0), uid: z.string().min(1), len: z.number().int().min(1) })
);

const bodySchema = z.discriminatedUnion("kind", [
  // 텍스트 발송 → sendChatMessageAsAdmin
  z.object({
    kind: z.literal("TEXT"),
    threadId: z.string().min(1),
    text: z.string().min(1).max(4000), // 실제 발송 본문(번역문 vi 등)
    // 발신자가 입력한 원문(예: 한국어). 있으면 villa가 text=원문·translatedText=발송문으로 저장(역번역 아님 — 원문 그대로 보존).
    originalText: z.string().max(4000).optional(),
    // 그룹 @멘션(선택) — villa가 zca-js 실제 멘션으로 전송.
    mentions: mentionSchema.optional(),
  }),
  // 이미지 발송 → sendChatImageAsAdmin. 바이너리는 base64로 전달(서버-서버 JSON).
  z.object({
    kind: z.literal("IMAGE"),
    threadId: z.string().min(1),
    imageBase64: z.string().min(1),
    fileName: z.string().min(1).max(200),
    caption: z.string().max(4000).optional(),
  }),
  // 답글(인용) 발송 → sendChatReplyAsAdmin
  z.object({
    kind: z.literal("REPLY"),
    threadId: z.string().min(1),
    text: z.string().min(1).max(4000),
    quote: replyQuoteSchema,
    // 발신자 입력 원문(있으면 villa가 ko+vi로 저장 — TEXT와 동일).
    originalText: z.string().max(4000).optional(),
    // 그룹 @멘션(선택).
    mentions: mentionSchema.optional(),
  }),
  // 리액션 발송 → addReactionAsAdmin
  z.object({
    kind: z.literal("REACTION"),
    threadId: z.string().min(1),
    target: z.object({
      zaloMsgId: z.string().min(1),
      cliMsgId: z.string().min(1),
    }),
    iconKey: z.enum(REACTION_KEYS),
  }),
  // 전달(forward) → sendChatForwardAsAdmin. message=원본 본문 텍스트(빈값 400).
  // reference(선택)=원본 id·ts·logSrcType·fwLvl("전달됨" 데코용 — 미보유여도 발송).
  z.object({
    kind: z.literal("FORWARD"),
    threadId: z.string().min(1),
    message: z.string().min(1).max(4000),
    reference: z
      .object({
        id: z.string().min(1),
        ts: z.number(),
        logSrcType: z.number(),
        fwLvl: z.number(),
      })
      .optional(),
  }),
]);

export async function POST(req: Request) {
  // ── A5 시크릿 게이트 (첫 줄 인증) — S1·S2 공통 헬퍼 ──
  if (!isExtSecretValid(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // ── A5 ownerAdminId 서버 결정 (요청 파라미터 미수용) ──
  // 1순위: SYSTEM_BOT DB 동적 해석. 2순위: env ZALO_SYSTEM_OWNER_ID. 둘 다 없으면 503.
  const ownerAdminId = await resolveSystemOwnerId();
  if (!ownerAdminId) {
    return NextResponse.json({ error: "SYSTEM_BOT_UNAVAILABLE" }, { status: 503 });
  }

  // ── 본문 파싱·검증 ──
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
  const body = parsed.data;

  // ── threadId 정규화 — cuid/zaloUserId 모두 실제 Zalo uid로 (전 kind 공통) ──
  //    테오 스코프 조회. 매칭 실패 시 body.threadId 그대로(방어). ownerAdminId 무변경.
  //    ADR-0010 S4: GROUP 대화면 threadType=Group으로 발송(전 kind 공통).
  const { zaloUserId: threadId, threadType, conversationId } = await resolveThreadZaloUserId(
    ownerAdminId,
    body.threadId
  );

  // ── 발송 (기존 함수 재사용, ownerAdminId 서버 고정, threadId 정규화본 사용) ──
  try {
    if (body.kind === "TEXT") {
      const res = await sendChatMessageAsAdmin(
        ownerAdminId,
        threadId,
        body.text,
        threadType,
        body.mentions
      );
      if (!res.ok) {
        return NextResponse.json({ error: "SEND_FAILED", reason: res.error }, { status: 502 });
      }
      // 원문(ko) 보존 — 있으면 villa 정본에 ko+vi로 저장(역번역 아님, 원문 그대로). conversationId 없으면 echo 위임.
      if (body.originalText && conversationId) {
        await persistOutboundOriginal(conversationId, ownerAdminId, res.messageId, body.originalText, body.text);
      }
      return NextResponse.json({ ok: true, kind: "TEXT", messageId: res.messageId });
    }

    if (body.kind === "IMAGE") {
      let buffer: Buffer;
      try {
        buffer = Buffer.from(body.imageBase64, "base64");
      } catch {
        return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
      }
      if (buffer.length === 0) {
        return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
      }
      const res = await sendChatImageAsAdmin(
        ownerAdminId,
        threadId,
        buffer,
        body.fileName,
        body.caption,
        threadType
      );
      if (!res.ok) {
        return NextResponse.json({ error: "SEND_FAILED", reason: res.error }, { status: 502 });
      }
      return NextResponse.json({ ok: true, kind: "IMAGE", messageId: res.messageId });
    }

    if (body.kind === "REPLY") {
      const res = await sendChatReplyAsAdmin(
        ownerAdminId,
        threadId,
        body.text,
        {
          zaloMsgId: body.quote.zaloMsgId,
          cliMsgId: body.quote.cliMsgId,
          content: body.quote.content,
          uidFrom: body.quote.uidFrom,
        },
        threadType,
        body.mentions
      );
      if (!res.ok) {
        return NextResponse.json({ error: "SEND_FAILED", reason: res.error }, { status: 502 });
      }
      if (body.originalText && conversationId) {
        await persistOutboundOriginal(conversationId, ownerAdminId, res.messageId, body.originalText, body.text);
      }
      return NextResponse.json({ ok: true, kind: "REPLY", messageId: res.messageId });
    }

    if (body.kind === "FORWARD") {
      const res = await sendChatForwardAsAdmin(
        ownerAdminId,
        threadId,
        body.message,
        body.reference,
        threadType
      );
      if (!res.ok) {
        return NextResponse.json({ error: "SEND_FAILED", reason: res.error }, { status: 502 });
      }
      return NextResponse.json({ ok: true, kind: "FORWARD", messageId: res.messageId });
    }

    // body.kind === "REACTION"
    const res = await addReactionAsAdmin(
      ownerAdminId,
      threadId,
      { zaloMsgId: body.target.zaloMsgId, cliMsgId: body.target.cliMsgId },
      body.iconKey,
      threadType
    );
    if (!res.ok) {
      return NextResponse.json({ error: "SEND_FAILED", reason: res.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, kind: "REACTION" });
  } catch (e) {
    // 예기치 못한 서버 오류 — credential·시크릿 미노출(메시지 길이 제한 + 일반 코드).
    return NextResponse.json(
      { error: "INTERNAL_ERROR", reason: (e instanceof Error ? e.message : "unknown").slice(0, 200) },
      { status: 500 }
    );
  }
}
