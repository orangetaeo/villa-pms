import { prisma } from "@/lib/prisma";
import { notifyB2cBalancesDue } from "@/lib/b2c-schedule";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * B2C 잔금 도래 운영자 알림 cron (ADR-0048 P4) — 체크인 D-14 도달 예약의 잔금 청구를 운영자(테오)에게 통지.
 * 대상: 스케줄 status=DEPOSIT_PAID & 잔금>0 & balanceDueDate == 오늘. 멱등: 날짜 정확 매칭(1일 1회 등록 전제).
 * 인증: Authorization: Bearer ${CRON_SECRET} — expire-holds·checkout-reminder 동일 패턴. Railway cron 등록은 OPS.
 */
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "b2c-balance-due");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const summary = await notifyB2cBalancesDue(prisma, new Date());
    if (summary.notificationCount > 0) {
      console.log(
        `[cron/b2c-balance-due] 잔금 도래 ${summary.targetCount}건 → 운영자 알림 ${summary.notificationCount}건`
      );
    }
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/b2c-balance-due] 실패", e);
    return Response.json({ error: "B2C 잔금 알림 처리에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
