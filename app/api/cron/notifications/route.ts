// [SHARED-MODULE] Zalo OA 발송 패턴 (Nike 프로젝트 계보)
import { dispatchPendingNotifications } from "@/lib/zalo";

/**
 * Zalo 알림 발송 cron 진입점 (SPEC F5, 계약: docs/contracts/T3.5-zalo-send.md)
 * 인증: Authorization: Bearer ${CRON_SECRET} — 검증 없는 cron 라우트는 배포 차단 (ops 규칙)
 * 재시도 정책: FAILED 최대 3회 (payload._attempt), NO_ZALO_LINK는 영구 제외
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // 미설정 환경에서 무인증 개방 금지 — 명시적 실패
    console.error("[cron/notifications] CRON_SECRET 미설정");
    return Response.json({ error: "CRON_SECRET이 설정되지 않았습니다" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await dispatchPendingNotifications();
    if (summary.failed > 0) {
      console.error(`[cron/notifications] 발송 실패 ${summary.failed}건`, JSON.stringify(summary));
    }
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/notifications] 발송 배치 실패", e);
    return Response.json({ error: "알림 발송에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
