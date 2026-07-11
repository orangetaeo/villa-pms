import { prisma } from "@/lib/prisma";
import { runCheckoutReminders } from "@/lib/checkout-reminder";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * D-1 체크아웃 사전 청소 알림 cron (T-checkout-advance-notify)
 * 인증: Authorization: Bearer ${CRON_SECRET} — 기존 cron 패턴. 일 1회 등록(OPS).
 * 멱등: 대상은 checkOut==today+1 정확 매칭이라 예약당 1회 발송.
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "checkout-reminder");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const summary = await runCheckoutReminders(prisma, new Date());
    if (summary.notificationCount > 0) {
      console.log(
        `[cron/checkout-reminder] 내일 체크아웃 ${summary.targetCount}건 → 사전 청소알림 ${summary.notificationCount}건`
      );
    }
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/checkout-reminder] 실패", e);
    return Response.json({ error: "사전 청소 알림 처리에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
