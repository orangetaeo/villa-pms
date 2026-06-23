// POST /api/cost-alerts/dismiss — 견적 중 원가 변경 경보 확인 처리 (ADMIN 전용, F)
//
// 권한: ADMIN 전용. 본인(userId) 소유의 RATE_CHANGED_DURING_PROPOSAL 알림만 처리(타인 알림 누수 차단).
// 동작: PENDING → SENT 로 표시(확인 완료) → 경보 목록에서 제거. 감사 로그 기록.
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { NotificationType } from "@prisma/client";
import { isSystemAdmin } from "@/lib/permissions";

const schema = z.object({
  notificationIds: z.array(z.string().min(1)).min(1).max(100),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const adminId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // 본인 소유 + 해당 타입만 — 스코프 강제 (타 관리자·타 타입 알림은 무시)
  const result = await prisma.notification.updateMany({
    where: {
      id: { in: parsed.data.notificationIds },
      userId: adminId,
      type: NotificationType.RATE_CHANGED_DURING_PROPOSAL,
      status: "PENDING",
    },
    data: { status: "SENT", sentAt: new Date() },
  });

  await writeAuditLog({
    userId: adminId,
    action: "UPDATE",
    entity: "Notification",
    entityId: parsed.data.notificationIds[0],
    changes: {
      type: { new: "RATE_CHANGED_DURING_PROPOSAL" },
      status: { old: "PENDING", new: "SENT" },
      dismissedCount: { new: result.count },
    },
  });

  return Response.json({ dismissed: result.count });
}
