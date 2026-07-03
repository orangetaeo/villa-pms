// /api/admin/notifications/read — 운영자 인앱 알림 전체 읽음 처리 (admin-vendor-ops C)
//   POST: isOperator + 본인 userId 스코프 강제. updateMany where {userId, readAt:null}.
//   시스템 발생 이벤트의 읽음 상태 변경이라 AuditLog는 과함(생략, vendor/read 미러).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-guard";
import { isOperator } from "@/lib/permissions";

export async function POST(req: Request) {
  // 중앙 가드(P1-S8) — 운영자 전용. 권한 부족 시 403 + AUTHZ_DENY 기록.
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const userId = g.session.user.id; // ★ 본인 스코프 — 타 운영자 알림 차단(where userId 필수)

  const result = await prisma.inAppNotification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ updated: result.count });
}
