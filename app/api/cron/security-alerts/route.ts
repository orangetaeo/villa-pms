import { prisma } from "@/lib/prisma";
import { runSecurityAlerts } from "@/lib/security-alerts";

/**
 * 보안 이상탐지 경보 cron 진입점 (보안 P3-S3 — 10분 주기 권장, Railway cron 등록은 OPS)
 * 인증: Authorization: Bearer ${CRON_SECRET} — 기존 cron 패턴. 멱등(빈 윈도우=0건).
 * SecurityEvent 임계치 초과 시 운영자(테오)에게 Zalo 경보(60분 쿨다운).
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/security-alerts] CRON_SECRET 미설정");
    return Response.json({ error: "CRON_SECRET이 설정되지 않았습니다" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runSecurityAlerts(prisma, new Date());
    if (summary.alertsSent > 0) {
      console.log(
        `[cron/security-alerts] ${summary.categories.join(",")} → ${summary.alertsSent}건 경보`
      );
    }
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/security-alerts] 실패", e instanceof Error ? e.message : String(e));
    return Response.json({ error: "경보 처리에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
