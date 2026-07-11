import { prisma } from "@/lib/prisma";
import { expireHolds } from "@/lib/hold";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * 홀드 만료 cron 진입점 (SPEC F3 — 5분 주기, Railway cron 등록은 OPS)
 * 인증: Authorization: Bearer ${CRON_SECRET} — ical-sync와 동일 패턴
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "expire-holds");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

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
