// GET /api/zalo/inbox — /messages 인박스 클라이언트 폴링 조회 (perf #2, 2026-06-24)
// MessagesClient(클라이언트 컨테이너)가 5초마다 router.refresh 대신 이 라우트를 fetch해
// 인박스(미읽음·미리보기·totalUnread)를 갱신한다(서버 왕복 = page.tsx 전체 재실행 제거).
//
// 보안:
//  - 첫 줄 인증: 운영자(isOperator) 아니면 401/403.
//  - 본인 스코프(ADR-0007): getInboxData가 where { ownerAdminId } 강제 — 타 관리자 대화는 목록에 없음.
//  - 누수 0(사업 원칙 1·2): getInboxData select 화이트리스트 — 마진·판매가·원가·credential 미조회.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isOperator } from "@/lib/permissions";
import { getInboxData } from "@/app/(admin)/messages/_thread-data";

// 수신 메시지·미읽음 변화를 폴링으로 반영해야 하므로 항상 동적.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // selectedId는 클라이언트가 prop으로 selected 하이라이트를 재계산하므로 서버에선 불필요(null).
  const { items, totalUnread } = await getInboxData(session.user.id, null);
  return NextResponse.json({ items, totalUnread });
}
