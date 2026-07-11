import { prisma } from "@/lib/prisma";
import { runIcalSync } from "@/lib/ical";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * iCal 수신 동기화 cron 진입점 (SPEC F2 — Railway 30분 주기)
 * 인증: Authorization: Bearer ${CRON_SECRET} — 검증 없는 cron 라우트는 배포 차단 (ops 규칙)
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "ical-sync");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const summary = await runIcalSync(prisma);
    if (summary.errorCount > 0 || summary.conflictCount > 0) {
      // Phase 1: 콘솔 경보 (T2.6 대시보드 배너·T3.5 알림 발송 전까지의 가시화 수단)
      console.error(
        `[cron/ical-sync] 에러 ${summary.errorCount}건, 더블부킹 충돌 ${summary.conflictCount}건`,
        JSON.stringify(
          summary.results.filter((r) => r.errors.length > 0 || r.conflicts.length > 0)
        )
      );
    }
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/ical-sync] 동기화 실패", e);
    return Response.json({ error: "iCal 동기화에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
