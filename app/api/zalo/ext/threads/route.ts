// GET /api/zalo/ext/threads — Nike→villa 채팅 목록 읽기(정본) 엔드포인트 (S2 / ADR-0010 A2)
//
// 목적: ADR-0010 A안에서 villa-pms가 테오 Zalo 채팅 정본을 보유한다. Nike(B3)는 테오 세션의
//       채팅 목록(recentchat)을 인메모리/로컬이 아니라 이 엔드포인트(villa 정본)에서 가져온다.
//
// 보안(A5 계승):
//   - 시크릿 게이트: x-zalo-ext-secret vs ZALO_EXT_SHARED_SECRET (timingSafeEqual). → 401.
//   - ownerAdminId(테오)는 요청에서 받지 않고 서버 결정(SYSTEM_BOT/env). 미해석 → 503.
//   - 쿼리는 messages/page.tsx 인박스 select(L119~144)를 그대로 재사용 — credential·마진·판매가·
//     재고 모델 미참조. 응답 DTO는 계약 ③ 화이트리스트만(아래 ThreadDTO). 타 관리자 대화 0건.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isExtSecretValid, resolveSystemOwnerId } from "@/lib/zalo-ext-auth";

export const dynamic = "force-dynamic";

/**
 * 그룹 멤버 스냅샷(Json)을 응답용으로 화이트리스트 정제 (ADR-0010 S4).
 * zaloId·name·avatarUrl 3개 필드만 통과 — 예상 외 필드가 섞여도 외부로 새지 않게 강제 한정.
 * 1:1(null)·비배열이면 null. 공개 프로필 정보만이라 credential·금액·마진과 무관.
 */
function sanitizeGroupMembers(
  raw: unknown
): { zaloId: string; name: string; avatarUrl: string | null }[] | null {
  if (!Array.isArray(raw)) return null;
  const members = raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({
      zaloId: typeof m.zaloId === "string" ? m.zaloId : "",
      name: typeof m.name === "string" ? m.name : "",
      avatarUrl: typeof m.avatarUrl === "string" ? m.avatarUrl : null,
    }))
    .filter((m) => m.zaloId.length > 0);
  return members.length > 0 ? members : null;
}

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

  // ── 인박스 쿼리 — messages/page.tsx L119~144 인박스 select 재사용 ──
  //    마진·금액 필드 미조회(누수 차단). 테오 대화만. 연결 사용자명/대표 빌라명만.
  const conversations = await prisma.zaloConversation.findMany({
    where: { ownerAdminId },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      // zaloUserId = 상대 Zalo id(채팅 식별자). Nike가 발송 시 threadId로 직접 쓸 수 있게 노출.
      //   누수 무관(마진·판매가·credential 아님). send route가 cuid도 정규화하므로 당장은 둘 다 동작.
      zaloUserId: true,
      displayName: true,
      nickname: true,
      avatarUrl: true,
      counterpartyType: true,
      // ADR-0010 S4 — 그룹 표시(Nike B6·villa FE). USER|GROUP + 멤버 스냅샷(이름·아바타·zaloId만).
      threadType: true,
      groupMembers: true,
      lastMessageAt: true,
      lastInboundAt: true,
      unreadCount: true,
      userId: true,
      user: {
        select: {
          name: true,
          villas: { select: { name: true }, take: 1, orderBy: { createdAt: "asc" } },
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { text: true, msgType: true },
      },
    },
  });

  // ── 응답 DTO — 계약 ③ threads 화이트리스트만 (credential·금액·마진 0건) ──
  const threads = conversations.map((c) => ({
    id: c.id,
    // 상대 Zalo id — Nike가 발송 threadId로 직접 사용(점진 전환). credential·금액 아님.
    zaloUserId: c.zaloUserId,
    displayName: c.displayName,
    nickname: c.nickname,
    avatarUrl: c.avatarUrl,
    counterpartyType: c.counterpartyType,
    // ADR-0010 S4 — 그룹 여부 + 멤버 스냅샷. 멤버는 이름·아바타·zaloId만(공개 프로필, 누수 무관).
    threadType: c.threadType,
    groupMembers: sanitizeGroupMembers(c.groupMembers),
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    lastInboundAt: c.lastInboundAt ? c.lastInboundAt.toISOString() : null,
    unreadCount: c.unreadCount,
    // 마지막 메시지 미리보기 1건 (text/msgType만)
    lastMessage: c.messages[0]
      ? { text: c.messages[0].text ?? "", msgType: c.messages[0].msgType ?? "text" }
      : null,
    // 연결 사용자 표시명 + 대표 빌라명 (이름만 — 마진·가격 없음)
    user: c.user
      ? { name: c.user.name ?? null, villaName: c.user.villas[0]?.name ?? null }
      : null,
  }));

  return NextResponse.json({ threads });
}
