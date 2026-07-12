// 유효 환율 AUTO 자동 갱신 cron 진입점 (FX_VND_PER_KRW·FX_VND_PER_USD)
// 인증: Authorization: Bearer ${CRON_SECRET} — 검증 없는 cron 라우트는 배포 차단 (ops 규칙)
// FX_MODE != AUTO면 무동작(skipped_manual). Railway 일 1회(예: 매일 09:00 ICT) 주기 권장.
import { prisma } from "@/lib/prisma";
import { runFxAutoUpdate } from "@/lib/fx-auto-update";
import { verifyCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "fx-update");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const result = await runFxAutoUpdate(prisma);
    for (const k of result.keys) {
      if (k.status === "updated") {
        console.log(`[cron/fx-update] ${k.key} ${k.oldValue ?? "(미설정)"} → ${k.newValue}`);
      } else if (k.status === "invalid") {
        console.error(`[cron/fx-update] ${k.key} 갱신 보류: invalid(시세 이상치)`);
      }
    }
    if (result.status === "no_rate") {
      console.error(`[cron/fx-update] 갱신 보류: no_rate(외부 시세 조회 실패)`);
    }
    return Response.json(result);
  } catch (e) {
    console.error("[cron/fx-update] 자동 갱신 실패", e);
    return Response.json({ error: "환율 자동 갱신에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
