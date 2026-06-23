// GET /api/zalo/ext/group-members?conversationId — Nike→villa 그룹 멤버 조회 (2026-06-23)
//
// 목적: Nike @멘션 드롭다운이 테오 그룹의 멤버를 표시하려면 멤버 목록이 필요한데, Nike는 테오
//       세션이 없어(villa 단일 허브) 로컬 getGroupMembers가 빈 결과 → @전체만 떴다.
//       villa가 보유한 ZaloConversation.groupMembers 스냅샷을 내려준다.
//
// 보안(A5 계승): 시크릿 게이트 → 401. ownerAdminId(테오) 서버 결정 → 미해석 503.
//   테오 스코프(where id+ownerAdminId) → 404. 공개 프로필(이름·아바타·id)만, 마진·credential 0.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isExtSecretValid, resolveSystemOwnerId } from "@/lib/zalo-ext-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isExtSecretValid(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const ownerAdminId = await resolveSystemOwnerId();
  if (!ownerAdminId) {
    return NextResponse.json({ error: "SYSTEM_BOT_UNAVAILABLE" }, { status: 503 });
  }

  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "MISSING_CONVERSATION_ID" }, { status: 400 });
  }

  // 테오 스코프 가드 — id 또는 zaloUserId(그룹 id) 어느 쪽으로 와도 매칭(Nike가 cuid/그룹id 혼용 가능).
  const conv = await prisma.zaloConversation.findFirst({
    where: { ownerAdminId, OR: [{ id: conversationId }, { zaloUserId: conversationId }] },
    select: { groupMembers: true },
  });
  if (!conv) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // groupMembers([{zaloId,name,avatarUrl}]) → Nike getGroupMembers 형식({uid,displayName,avatar}).
  const members = Array.isArray(conv.groupMembers)
    ? (conv.groupMembers as { zaloId?: unknown; name?: unknown; avatarUrl?: unknown }[])
        .filter((m) => m && typeof m === "object" && typeof m.zaloId === "string")
        .map((m) => ({
          uid: m.zaloId as string,
          displayName: typeof m.name === "string" ? m.name : "",
          avatar: typeof m.avatarUrl === "string" ? m.avatarUrl : "",
        }))
    : [];

  return NextResponse.json({ members });
}
