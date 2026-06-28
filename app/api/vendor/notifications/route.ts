// /api/vendor/notifications — 원천 공급자 인앱 알림센터 목록·미읽음 수 (ADR-0023 후속)
//   GET: Role=VENDOR + 본인 userId 스코프 강제(세션). 자기 알림만.
//   ★ 누수: InAppNotification엔 판매가·마진 필드가 애초에 없음. select 화이트리스트로 한 번 더 봉인.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isVendor, type Role } from "@/lib/permissions";
import { listForUser, unreadCount } from "@/lib/inapp-notification";

// 한 화면에 보여줄 최근 알림 수(폴링 기반 — 무한스크롤 불필요)
const LIST_LIMIT = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const userId = session.user.id; // ★ 본인 스코프 — 타 사용자 알림 조회 불가
  const [items, unread] = await Promise.all([
    listForUser(userId, LIST_LIMIT),
    unreadCount(userId),
  ]);

  return NextResponse.json({
    unread,
    notifications: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  });
}
