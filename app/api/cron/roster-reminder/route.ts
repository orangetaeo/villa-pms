import { prisma } from "@/lib/prisma";
import { runRosterReminders } from "@/lib/roster-reminder";

/**
 * D-3 투숙객 명단 미입력 리마인더 cron (T-roster-reminder-cron)
 * 인증: Authorization: Bearer ${CRON_SECRET} — 기존 cron 패턴. 일 1회 등록(OPS).
 * 멱등: 대상은 checkIn==today+3 정확 매칭이라 예약당 1회 발송.
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/roster-reminder] CRON_SECRET 미설정");
    return Response.json({ error: "CRON_SECRET이 설정되지 않았습니다" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runRosterReminders(prisma, new Date());
    if (summary.notificationCount > 0) {
      console.log(
        `[cron/roster-reminder] 대상 ${summary.targetCount}건 → 알림 ${summary.notificationCount}건`
      );
    }
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/roster-reminder] 실패", e);
    return Response.json({ error: "명단 리마인더 처리에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
