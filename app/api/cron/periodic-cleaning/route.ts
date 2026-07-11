import { prisma } from "@/lib/prisma";
import { createPeriodicCleaningTasks } from "@/lib/cleaning";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * 정기 방역 태스크 생성 cron 진입점 (SPEC F4 — 월 1회, ADR-0002 주기 고정)
 * 인증: Authorization: Bearer ${CRON_SECRET} — 기존 cron 패턴. 멱등(같은 달 skip)
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "periodic-cleaning");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const summary = await createPeriodicCleaningTasks(prisma, new Date());
    if (summary.createdCount > 0) {
      console.log(
        `[cron/periodic-cleaning] ${summary.monthKey} 생성 ${summary.createdCount}건, skip ${summary.skippedCount}건`
      );
    }
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/periodic-cleaning] 실패", e);
    return Response.json({ error: "정기 청소 생성에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
