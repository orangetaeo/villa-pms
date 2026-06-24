// GET /api/zalo/conversations/[id]/thread — /messages 대화 스레드 클라이언트 조회 (perf #2, 2026-06-24)
// MessagesClient가 인박스 클릭/폴링 시 서버 왕복 없이 이 라우트로 스레드만 교체한다
// (헤더 + 최근 80개 + hasOlder/oldestCursor + groupMembers + hasUnread).
//
// 보안:
//  - 첫 줄 인증: 운영자(isOperator) 아니면 401/403.
//  - 본인 스코프(ADR-0007): getThreadData가 where { id, ownerAdminId } — 타 관리자/미존재 대화는 null → 404
//    (id 추측 접근 차단, 누수 0).
//  - 누수 0(사업 원칙 1·2): getThreadData select 화이트리스트 — 마진·판매가 미조회. 매핑은 toChatMessages 단일 진실원.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOperator } from "@/lib/permissions";
import { getThreadData } from "@/app/(admin)/messages/_thread-data";

// 수신 메시지를 폴링으로 반영해야 하므로 항상 동적.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const data = await getThreadData(session.user.id, id);
  if (!data) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(data);
}
