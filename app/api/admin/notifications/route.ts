// /api/admin/notifications — 운영자 인앱 알림센터 목록·미읽음 수 (admin-vendor-ops C)
//   GET: isOperator + 본인 userId 스코프 강제(세션) — 타 운영자 알림 비노출.
//   ★ 누수: InAppNotification엔 판매가·마진 필드가 애초에 없음. select 화이트리스트로 한 번 더 봉인.
//   /api/vendor/notifications 미러(수신자 role만 다름).
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-guard";
import { isOperator } from "@/lib/permissions";
import { listForUser, unreadCount } from "@/lib/inapp-notification";

// 한 화면에 보여줄 최근 알림 수(폴링 기반 — 무한스크롤 불필요)
const LIST_LIMIT = 30;

export async function GET(req: Request) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const userId = g.session.user.id; // ★ 본인 스코프 — 타 운영자 알림 조회 불가
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
