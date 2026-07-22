// POST /api/zalo/messages — ADMIN 수동 채팅 발신 (T6.6, b14, ADR-0003)
// 흐름: ZaloMessage(OUTBOUND·CHAT) 영속 → sendBotMessage 시도 → status SENT/FAILED 갱신
//       → conversation.lastMessageAt 갱신 → AuditLog
// 발송 실패(봇 미연결·타임아웃·API 오류)는 status=FAILED로 기록하되 500 금지 — 영속은 200.
// 마진·판매가·KRW 절대 미포함 (사업 원칙 2).
// ADR-0006 D5.5: 개인계정(zca-js)은 48h CS 제약 없음 → isReplyWindowOpen 가드 제거(입력창 항상 활성).
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  Prisma,
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
} from "@prisma/client";
import { ThreadType } from "zca-js";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { translateText, previewTargetForMode, GeminiNotConfiguredError } from "@/lib/gemini";
import { reanchorMentions } from "@/lib/zalo-mentions";
import {
  sendChatMessageAsAdmin,
  sendChatReplyAsAdmin,
  getOwnIdForAdmin,
} from "@/lib/zalo-runtime";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { toChatMessages, chatInitials } from "@/lib/zalo-chat-message";
import { resolveQuotedAnchors } from "@/lib/zalo-quote-anchor";
// 실시간(SSE) — 발신 영속 후 본인(ownerAdminId) 채널로 "outbound" 신호 발행(인박스 즉시 갱신).
import { publish as publishRealtime } from "@/lib/realtime-bus";

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
  // W1 최적화 — 입력창 미리보기(/api/zalo/translate)에서 이미 번역된 결과를 그대로 재사용해
  //   같은 텍스트 Gemini 재번역(발송당 2회→1회) 생략. 클라가 "현재 입력=미리보기 대상"일 때만 전송.
  clientTranslated: z.string().trim().min(1).max(8000).optional(),
});

// GET /api/zalo/messages?conversationId&before&limit — ADMIN 이전 메시지 점진 로드(prepend).
//   /messages 채팅창이 상단 스크롤 시 호출. 초기 80개 위로 더 과거 메시지를 페이지네이션.
//
// 보안:
//   - 첫 줄 인증: 운영자(isOperator) 아니면 401/403. ext/messages(시크릿)와 달리 세션 인증.
//   - 본인 스코프: where { id: conversationId, ownerAdminId = session.user.id }. 타 관리자 대화 404(누수 0).
//   - 누수 0: 매핑은 page.tsx와 동일한 toChatMessages 화이트리스트. 마진·판매가·supplierCost·credential 미조회.
const DEFAULT_OLDER_LIMIT = 80;
const MAX_OLDER_LIMIT = 200;

export async function GET(req: Request) {
  // 권한 검사 — ADMIN 전용 (POST와 동일 패턴)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "MISSING_CONVERSATION_ID" }, { status: 400 });
  }
  const before = url.searchParams.get("before");
  if (!before) {
    return NextResponse.json({ error: "MISSING_BEFORE" }, { status: 400 });
  }
  const beforeDate = new Date(before);
  if (Number.isNaN(beforeDate.getTime())) {
    return NextResponse.json({ error: "INVALID_BEFORE" }, { status: 400 });
  }
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_OLDER_LIMIT)
      : DEFAULT_OLDER_LIMIT;

  // 본인 스코프 가드 — 본인(ownerAdminId) 대화만(id 추측으로 타 관리자 접근 차단, 누수 0).
  // 헤더 아바타·이니셜 매핑 정합을 위해 displayName 우선순위 재료(nickname/user.name/displayName)도 조회.
  const conv = await prisma.zaloConversation.findFirst({
    where: { id: conversationId, ownerAdminId: session.user.id },
    select: {
      id: true,
      displayName: true,
      nickname: true,
      avatarUrl: true,
      threadType: true,
      groupMembers: true,
      user: { select: { name: true } },
    },
  });
  if (!conv) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 그룹 멤버 스냅샷 zaloId→{name,avatarUrl} (1:1은 빈 맵, senderName 항상 null). 공개 프로필만(누수 무관).
  const isGroup = conv.threadType === "GROUP";
  const memberMap = new Map<string, { name: string | null; avatarUrl: string | null }>();
  if (isGroup && Array.isArray(conv.groupMembers)) {
    for (const m of conv.groupMembers as { zaloId?: unknown; name?: unknown; avatarUrl?: unknown }[]) {
      if (m && typeof m.zaloId === "string") {
        memberMap.set(m.zaloId, {
          name: typeof m.name === "string" ? m.name : null,
          avatarUrl: typeof m.avatarUrl === "string" ? m.avatarUrl : null,
        });
      }
    }
  }
  // 헤더(대화 상대) 아바타·이니셜 — page.tsx displayNameOf 우선순위(nickname > user.name > displayName).
  const headerName = conv.nickname ?? conv.user?.name ?? conv.displayName ?? "";

  // 이전 메시지 조회 — before 이전(createdAt < before)에서 최신순 limit건. 본인 대화 스코프 재확인.
  const rows = await prisma.zaloMessage.findMany({
    where: {
      conversationId,
      conversation: { ownerAdminId: session.user.id },
      createdAt: { lt: beforeDate },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      direction: true,
      source: true,
      msgType: true,
      senderUid: true,
      text: true,
      translatedText: true,
      captionTranslated: true,
      attachmentUrls: true,
      status: true,
      createdAt: true,
      zaloMsgId: true,
      globalMsgId: true,
      cliMsgId: true,
      quotedMsgId: true,
      quotedText: true,
      quotedSender: true,
      reactions: true,
    },
  });

  const hasMore = rows.length === limit;
  // 화면 표시 순서(오래된→최신)로 재정렬 후 page.tsx와 동일 매핑.
  const ordered = rows.slice().reverse();
  const nextCursor = ordered.length > 0 ? ordered[0].createdAt.toISOString() : null;
  const mapped = toChatMessages(ordered, {
    isGroup,
    memberMap,
    headerAvatarUrl: conv.avatarUrl,
    headerInitials: chatInitials(headerName),
  });
  // 답글 인용 점프 앵커 변환 — 수신 답글의 quotedMsgId(globalMsgId)를 버블 앵커 zaloMsgId로 치환(prepend 정합).
  const messages = await resolveQuotedAnchors(mapped, ordered, conversationId);

  return NextResponse.json({ messages, hasMore, nextCursor });
}

export async function POST(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;

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
  const { conversationId, text, quotedMessageId, mentions, clientTranslated } = parsed.data;

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
        // 그룹 인용 — 원문의 실제 발신자 식별(uidFrom). 1:1은 null.
        senderUid: true,
        conversation: { select: { displayName: true, nickname: true, groupMembers: true } },
      },
    });
    if (!original) {
      return NextResponse.json({ error: "QUOTED_NOT_FOUND" }, { status: 404 });
    }
    // zca-js quote는 원본 msgId + cliMsgId 둘 다 요구 — 과거(미보유) 메시지는 인용 불가(R3-4).
    if (!original.zaloMsgId || !original.cliMsgId) {
      return NextResponse.json({ error: "QUOTE_NOT_SUPPORTED" }, { status: 400 });
    }
    // 인용 uidFrom — zca-js는 인용 원문의 **실제 발신자 uid**를 요구한다.
    //  · 내 발신(OUTBOUND): 내 ownId.
    //  · 상대 발신(INBOUND): 그룹이면 원문 발신자 senderUid(★버그수정 — 그룹 id로 보내면 거부→전송실패),
    //    1:1이면 senderUid 없음 → 대화 상대 zaloUserId.
    let uidFrom = conversation.zaloUserId;
    if (original.direction === ZaloMessageDirection.OUTBOUND) {
      uidFrom = (await getOwnIdForAdmin(session.user.id)) ?? conversation.zaloUserId;
    } else if (original.senderUid) {
      uidFrom = original.senderUid;
    }
    // 인용 발신자 표시명 — 그룹이면 groupMembers에서 senderUid→이름, 아니면 대화 상대명.
    let quotedSender: string | null = null;
    if (original.direction !== ZaloMessageDirection.OUTBOUND) {
      if (original.senderUid && Array.isArray(original.conversation.groupMembers)) {
        const found = (original.conversation.groupMembers as { zaloId?: unknown; name?: unknown }[]).find(
          (m) => m && typeof m.zaloId === "string" && m.zaloId === original.senderUid
        );
        quotedSender =
          (found && typeof found.name === "string" ? found.name : null) ??
          original.senderUid ??
          original.conversation.nickname ??
          original.conversation.displayName ??
          null;
      } else {
        quotedSender = original.conversation.nickname ?? original.conversation.displayName ?? null;
      }
    }
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
  // 구간 계측 — "왜 전송 중이 오래 뜨나"를 추측 없이 가르기 위한 최소 관측(2026-07-22).
  //   translateMs=0이면 번역은 무관(OFF 모드는 아예 스킵), sendMs가 크면 Zalo 왕복, dbMs면 DB.
  const t0 = Date.now();
  let translateMs = 0;
  let sendMs = 0;

  let outboundText = text; // 실제 상대에게 가는 본문
  let translatedText: string | null = null; // 발송된 번역문(기록·OutboundBubble 표시)
  const target = previewTargetForMode(conversation.translateMode);
  if (target) {
    // W1: 운영자가 입력창 미리보기에서 확인·승인한 번역문(clientTranslated)이 오면 재번역 생략.
    //   ADMIN 본인이 미리보기로 본 값이라 신뢰(미발송 위험 없음). 미제공(미리보기 OFF·입력 변경·
    //   번역 진행 중)이면 기존대로 서버에서 1회 번역.
    const reuse = clientTranslated?.trim();
    if (reuse) {
      outboundText = reuse;
      translatedText = reuse;
    } else {
      const tTr = Date.now();
      try {
        const translated = (await translateText(text, target)).trim();
        translateMs = Date.now() - tTr;
        if (translated) {
          outboundText = translated;
          translatedText = translated;
        }
      } catch (err) {
        translateMs = Date.now() - tTr;
        if (err instanceof GeminiNotConfiguredError) {
          return NextResponse.json({ error: "TRANSLATE_NOT_CONFIGURED" }, { status: 503 });
        }
        // 상태 코드만 — 본문 에코 방지(QA 권고). 한국어 오발송 방지 위해 미발송.
        // ★관측 로그 필수: 이 실패는 화면에 "전송 실패"로만 보여, 로그가 없으면 원인 추적이 불가능했다.
        console.warn(
          `[zalo-send] 번역 실패로 미발송 (conv=${conversationId}, target=${target}): ` +
            `${err instanceof Error ? err.message : "unknown"}`
        );
        return NextResponse.json({ error: "TRANSLATE_FAILED" }, { status: 502 });
      }
    }
  }

  // 0b) @멘션 위치 재정렬 — 번역으로 본문이 바뀌면 mention pos/len이 어긋나 멘션이 안 걸린다.
  //     번역된 outboundText에서 멘션 토큰("@이름")을 다시 찾아 위치 재계산(못 찾으면 해당 멘션 버림).
  //     OFF 모드(번역 안 함, outboundText===text)면 그대로 사용.
  const outboundMentions =
    mentions && mentions.length > 0 && outboundText !== text
      ? reanchorMentions(text, outboundText, mentions)
      : mentions;

  // 1) 발송 시도 — 본인 계정으로 발신. 봇 미연결/실패는 status=FAILED 기록(500 금지). 48h 가드 없음(D5.5).
  let status: ZaloMessageStatus;
  let error: string | null = null;
  let zaloMsgId: string | null = null;

  const tSend = Date.now();
  const result = replyQuoteSource
    ? await sendChatReplyAsAdmin(
        session.user.id,
        conversation.zaloUserId,
        outboundText,
        replyQuoteSource,
        sendThreadType,
        outboundMentions
      )
    : await sendChatMessageAsAdmin(
        session.user.id,
        conversation.zaloUserId,
        outboundText,
        sendThreadType,
        outboundMentions
      );
  sendMs = Date.now() - tSend;
  if (result.ok) {
    status = ZaloMessageStatus.SENT;
    zaloMsgId = result.messageId;
  } else {
    status = ZaloMessageStatus.FAILED;
    error = result.error;
  }

  // 2) 영속 + lastMessageAt 갱신 + AuditLog (원자적)
  //
  // ★셀프에코 레이스(P2002) — 발송에 성공하면 zalo-worker 리스너가 **내 발신 에코**를 곧바로 받아
  //   saveOutboundEcho가 같은 (conversationId, zaloMsgId)로 OUTBOUND 행을 먼저 만들어 버리는 일이 잦다.
  //   이때 아래 create가 unique 위반(P2002)으로 터지면 500 → 클라가 "전송에 실패했습니다"를 띄우는데
  //   **실제로는 상대에게 이미 전달된 상태**라 운영자가 재전송해 중복 발송이 된다(프로덕션 실측 2026-07-22).
  //   → P2002면 실패로 처리하지 않고, 먼저 저장된 에코 행을 내 발신 기록(원문 ko·번역문·sentBy·인용)으로
  //     보강한다. 드롭 0·중복 0이고 화면에도 원문+번역이 정상 표시된다.
  const now = new Date();
  const messageSelect = {
    id: true,
    status: true,
    createdAt: true,
    quotedText: true,
    quotedSender: true,
  } as const;
  // 에코 행 보강 패치 — 에코가 못 가진 정보만 덮어쓴다(globalMsgId·cliMsgId·createdAt은 에코 값 유지).
  const echoPatch = {
    source: ZaloMessageSource.CHAT,
    msgType: "text",
    text, // 원문 한국어(에코엔 발송된 번역문만 있어 한국어가 유실됨)
    translatedText,
    status,
    error,
    sentBy: session.user.id,
    ...(quoteSnapshot
      ? {
          quotedMsgId: quoteSnapshot.quotedMsgId,
          quotedText: quoteSnapshot.quotedText,
          quotedSender: quoteSnapshot.quotedSender,
        }
      : {}),
  };

  // 트랜잭션 본문 — Postgres는 실패한 statement가 트랜잭션 전체를 중단시키므로 P2002 복구는
  // 트랜잭션 **밖에서** 새 트랜잭션으로 재시도한다(patchEcho=true).
  const persist = (patchEcho: boolean) =>
    prisma.$transaction(async (tx) => {
      const created =
        patchEcho && zaloMsgId
          ? await tx.zaloMessage.update({
              where: { conversationId_zaloMsgId: { conversationId, zaloMsgId } },
              data: echoPatch,
              select: messageSelect,
            })
          : await tx.zaloMessage.create({
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
              select: messageSelect,
            });

      await tx.zaloConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: now,
          // 인박스 미리보기 비정규화(perf) — 운영자 발신 원문 캐시.
          lastMessageText: text,
          lastMessageType: "text",
        },
      });

      // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙). 본문 텍스트는 기록하지 않음.
      await writeAuditLog({
        userId: session.user.id,
        action: patchEcho ? "UPDATE" : "CREATE",
        entity: "ZaloMessage",
        entityId: created.id,
        changes: {
          direction: { new: "OUTBOUND" },
          source: { new: "CHAT" },
          status: { new: status },
          ...(patchEcho ? { echoReconciled: { new: "true" } } : {}),
        },
        db: tx,
      });

      return created;
    });

  let message: Awaited<ReturnType<typeof persist>>;
  try {
    message = await persist(false);
  } catch (err) {
    if (
      zaloMsgId &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // 셀프에코가 먼저 저장됨 — 전송은 성공했으므로 실패 처리 금지. 그 행을 보강하고 정상 응답.
      message = await persist(true);
    } else {
      throw err;
    }
  }

  // 구간 로그 — 느림 체감의 원인(번역/Zalo왕복/DB)을 한 줄로 가른다. 본문·번역문은 기록하지 않는다.
  const totalMs = Date.now() - t0;
  if (totalMs >= 1000) {
    console.log(
      `[zalo-send] 소요 ${totalMs}ms (번역 ${translateMs}ms · Zalo발송 ${sendMs}ms · 그외 ${
        totalMs - translateMs - sendMs
      }ms, mode=${conversation.translateMode}, status=${status})`
    );
  }

  // 실시간(SSE) — 발신 영속 완료 후 본인(ownerAdminId) 채널로 "outbound" 신호 발행.
  // 비블로킹·예외 격리: 발행 실패가 응답에 영향 없게 try/catch(신호일 뿐 — 데이터는 클라이언트가 fetch).
  try {
    publishRealtime(session.user.id, { type: "outbound", conversationId });
  } catch {
    /* 실시간 발행 실패는 무해 — 클라이언트 폴백/다음 신호로 갱신 */
  }

  return NextResponse.json({
    id: message.id,
    status: message.status,
    error,
    createdAt: message.createdAt.toISOString(),
  });
}
