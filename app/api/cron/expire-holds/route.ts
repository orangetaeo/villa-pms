import { prisma } from "@/lib/prisma";
import { expireHolds } from "@/lib/hold";

/**
 * 홀드 만료 cron 진입점 (SPEC F3 — 5분 주기, Railway cron 등록은 OPS)
 * 인증: Authorization: Bearer ${CRON_SECRET} — ical-sync와 동일 패턴
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // 미설정 환경에서 무인증 개방 금지 — 명시적 실패
    console.error("[cron/expire-holds] CRON_SECRET 미설정");
    return Response.json({ error: "CRON_SECRET이 설정되지 않았습니다" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await expireHolds(prisma, new Date());
    if (summary.expiredCount > 0) {
      console.log(
        `[cron/expire-holds] ${summary.expiredCount}건 만료 처리`,
        summary.bookingIds.join(",")
      );
    }
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/expire-holds] 만료 처리 실패", e);
    return Response.json({ error: "홀드 만료 처리에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
