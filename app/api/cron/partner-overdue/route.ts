import { prisma } from "@/lib/prisma";
import { markOverdueReceivables } from "@/lib/partner-booking";

/**
 * 파트너 미수 연체 전이 cron (ADR-0022 PARTNER-3 — 1일 1회 권장, Railway cron 등록은 OPS)
 * 기한(dueDate) 경과한 미입금(PENDING/PARTIAL) 채권 → OVERDUE.
 * 연체 상태는 신용 게이트(hasOverdue)·대시보드 표시·자동 제재의 기준.
 * 인증: Authorization: Bearer ${CRON_SECRET} — expire-holds·ical-sync 동일 패턴
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/partner-overdue] CRON_SECRET 미설정");
    return Response.json({ error: "CRON_SECRET이 설정되지 않았습니다" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const overdueCount = await markOverdueReceivables(prisma, new Date());
    if (overdueCount > 0) {
      console.log(`[cron/partner-overdue] ${overdueCount}건 연체 전이`);
    }
    return Response.json({ overdueCount });
  } catch (e) {
    console.error("[cron/partner-overdue] 연체 전이 실패", e);
    return Response.json({ error: "연체 전이에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
