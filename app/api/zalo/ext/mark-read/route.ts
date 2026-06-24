// POST /api/zalo/ext/mark-read — Nike→villa 읽음 처리(unreadCount=0) (2026-06-24)
//
// 배경: 테오 대화의 unreadCount 정본은 villa. Nike에서 대화를 읽으면 로컬만 0으로 바뀌고
//       villa는 그대로라, 다음 폴링(ext/threads)에서 unreadCount가 되살아나 뱃지가 안 사라졌다.
//       Nike가 테오 대화를 열 때 이 엔드포인트로 villa unreadCount를 0으로 동기화한다.
//       (villa에서 읽으면 villa가 0으로 → Nike 폴링이 0을 받아 반영 — 그 방향은 기존에 동작.)
//
// 보안(A5 계승): 시크릿 게이트 → 401. ownerAdminId(테오) 서버 결정 → 미해석 503.
//   테오 스코프(updateMany where id+ownerAdminId) → 미존재 404. 멱등(여러 번 호출해도 0).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isExtSecretValid, resolveSystemOwnerId } from "@/lib/zalo-ext-auth";

const bodySchema = z.object({ conversationId: z.string().min(1) });

export async function POST(req: Request) {
  if (!isExtSecretValid(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const ownerAdminId = await resolveSystemOwnerId();
  if (!ownerAdminId) {
    return NextResponse.json({ error: "SYSTEM_BOT_UNAVAILABLE" }, { status: 503 });
  }

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

  // cuid(대화 id) 또는 zaloUserId(상대/그룹 id) 어느 쪽으로 와도 매칭(Nike가 혼용 가능). 테오 스코프.
  const cid = parsed.data.conversationId;
  const result = await prisma.zaloConversation.updateMany({
    where: { ownerAdminId, OR: [{ id: cid }, { zaloUserId: cid }] },
    data: { unreadCount: 0 },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, unreadCount: 0 });
}
