// GET /api/zalo/ext/messages?conversationId&before&limit — Nike→villa 메시지 읽기(정본) (S2 / ADR-0010 A3)
//
// 목적: Nike(B3)가 테오 대화 스크롤 시 과거 메시지(conversation/messages)를 villa 정본에서 로드.
//
// 보안(A5 계승):
//   - 시크릿 게이트(timingSafeEqual) → 401. ownerAdminId(테오) 서버 결정, 미해석 → 503.
//   - 테오 스코프: where { id: conversationId, ownerAdminId: 테오 }. 테오 대화 아니면 404(누수 0).
//   - 쿼리는 messages/page.tsx 스레드 select(L184~222) 재사용. 응답 DTO는 계약 ③ messages
//     화이트리스트만. credential·금액·마진·공유후보 미반환.
//
// 페이지네이션: before(cursor: createdAt ISO 또는 ZaloMessage.id) + limit(기본 50, 상한 200).
//   - 최신순(desc)으로 limit건을 조회한 뒤 createdAt asc로 재정렬해 반환(화면 표시 순서).
//   - hasMore: 조회 결과가 limit과 같으면 더 있을 수 있음(다음 before=가장 오래된 createdAt).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isExtSecretValid, resolveSystemOwnerId } from "@/lib/zalo-ext-auth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: Request) {
  // ── 시크릿 게이트 (첫 줄 인증) ──
  if (!isExtSecretValid(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // ── ownerAdminId 테오 서버 결정 (요청 파라미터 미수용) ──
  const ownerAdminId = await resolveSystemOwnerId();
  if (!ownerAdminId) {
    return NextResponse.json({ error: "SYSTEM_BOT_UNAVAILABLE" }, { status: 503 });
  }

  // ── 쿼리 파라미터 ──
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "MISSING_CONVERSATION_ID" }, { status: 400 });
  }
  const before = url.searchParams.get("before");
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // ── 테오 스코프 가드 — 테오 대화 아니면 404 (id 추측으로 타 관리자 접근 차단, 누수 0) ──
  const conv = await prisma.zaloConversation.findFirst({
    where: { id: conversationId, ownerAdminId },
    // zaloUserId 추가 — 응답에 상대 Zalo id를 실어 Nike가 발송 threadId로 쓸 수 있게(점진 전환).
    //   누수 무관(채팅 식별자, 마진·credential 아님). 테오 스코프 가드는 그대로.
    select: { id: true, zaloUserId: true },
  });
  if (!conv) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // ── before 커서 해석: createdAt ISO 우선, 실패 시 메시지 id로 조회 ──
  let beforeDate: Date | null = null;
  if (before) {
    const asDate = new Date(before);
    if (!Number.isNaN(asDate.getTime())) {
      beforeDate = asDate;
    } else {
      // 메시지 id로 간주 — 해당 메시지의 createdAt을 커서로 (테오 대화 내 메시지만)
      const cursorMsg = await prisma.zaloMessage.findFirst({
        where: { id: before, conversationId },
        select: { createdAt: true },
      });
      beforeDate = cursorMsg?.createdAt ?? null;
    }
  }

  // ── 메시지 조회 — page.tsx L203~219 스레드 select 재사용 (최신순 limit건) ──
  const rows = await prisma.zaloMessage.findMany({
    where: {
      conversationId,
      ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      direction: true,
      source: true,
      msgType: true,
      text: true,
      translatedText: true,
      attachmentUrls: true,
      status: true,
      createdAt: true,
      quotedText: true,
      quotedSender: true,
      reactions: true,
      // ADR-0010 S4 — 그룹 메시지 발신자 식별(FE가 groupMembers 스냅샷으로 이름·아바타 매핑). 1:1은 null.
      senderUid: true,
    },
  });

  const hasMore = rows.length === limit;
  // 화면 표시 순서(오래된→최신)로 재정렬
  const ordered = rows.slice().reverse();
  // 다음 페이지 커서 = 이번 페이지에서 가장 오래된 메시지의 createdAt
  const nextBefore = ordered.length > 0 ? ordered[0].createdAt.toISOString() : null;

  // ── 응답 DTO — 계약 ③ messages 화이트리스트만 (credential·금액·마진 0건) ──
  const messages = ordered.map((m) => ({
    id: m.id,
    direction: m.direction,
    source: m.source,
    msgType: m.msgType ?? "text",
    text: m.text ?? "",
    translatedText: m.translatedText,
    attachmentUrls: m.attachmentUrls,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    quotedText: m.quotedText,
    quotedSender: m.quotedSender,
    // 리액션 집계(Json {HEART:n,...}) — 아이콘별 카운트만(누수 무관)
    reactions: m.reactions ?? null,
    // 그룹 메시지 발신자 Zalo id(누수 무관 — 식별자). FE가 groupMembers로 이름·아바타 매핑. 1:1은 null.
    senderUid: m.senderUid,
  }));

  return NextResponse.json({
    messages,
    hasMore,
    nextBefore,
    // 상대 Zalo id — Nike가 발송 threadId로 직접 사용(점진 전환). credential·금액 아님.
    conversationZaloUserId: conv.zaloUserId,
  });
}
