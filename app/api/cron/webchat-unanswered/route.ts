import { prisma } from "@/lib/prisma";
import { runWebChatReminders } from "@/lib/webchat-reminder";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * 웹 채팅 미응답 리마인드 cron (T-webchat-unanswered-reminder)
 * 인증: Authorization: Bearer ${CRON_SECRET} — 기존 cron 패턴.
 * 등록 주기(OPS): 10분 간격 권장. 임계치는 WEBCHAT_UNANSWERED_MINUTES(기본 30분).
 * 멱등: 세션당 미응답 구간 1회(runWebChatReminders 내부 dedup).
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "webchat-unanswered");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const summary = await runWebChatReminders(prisma, new Date());
    if (summary.reminderCount > 0) {
      console.log(
        `[cron/webchat-unanswered] 미응답 후보 ${summary.candidateCount}건 → 리마인드 ${summary.reminderCount}건`
      );
    }
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/webchat-unanswered] 실패", e);
    return Response.json({ error: "웹 채팅 미응답 리마인드 처리에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
