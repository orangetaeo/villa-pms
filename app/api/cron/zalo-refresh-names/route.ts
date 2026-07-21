import { verifyCronAuth } from "@/lib/cron-auth";
import { refreshOwnerNamedConvos } from "@/lib/zalo-name-refresh";
import { shouldDelegate, delegateRefreshNames } from "@/lib/zalo-worker-client";

/**
 * [일회성 유지보수 cron] Zalo 대화명 보정 — 봇 소유자 이름으로 잘못 저장된 1:1 대화 교정.
 *
 * 배경: 과거 OUTBOUND 셀프에코의 data.dName(=봇 소유자 이름)이 상대 대화명으로 잘못 심겼다.
 * 코드 수정(zalo-runtime)은 앞으로를 막지만, 기존 오심 대화는 라이브 봇 세션(getUserInfo)으로
 * 즉시 교정한다. 새 Zalo 세션을 만들지 않아 프로덕션 소켓에 무해.
 *
 * ★ 세션 토폴로지: 프로덕션은 ZALO_SESSION_LOCAL=false라 세션을 zalo-worker가 보유한다.
 *   따라서 웹 프로세스에서 직접 getUserInfo를 부르면 전부 unresolved다 → shouldDelegate()면
 *   워커 /internal/refresh-names로 위임한다. 세션이 웹에 있는 개발 환경은 로컬 실행.
 *
 * 인증: verifyCronAuth(Bearer CRON_SECRET). query: dryRun=1, limit=N(기본 100, 최대 500).
 */
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "zalo-refresh-names");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const dryRun = url.searchParams.get("dryRun") === "1";

  try {
    // 세션은 워커에만 있으므로(SESSION_LOCAL=false) 위임. 세션이 로컬이면 직접 실행.
    if (shouldDelegate()) {
      const summary = await delegateRefreshNames({ limit, dryRun });
      if (!summary) {
        return Response.json(
          { error: "worker unreachable — 세션 보유 워커에 위임 실패" },
          { status: 502 }
        );
      }
      return Response.json({ via: "worker", ...summary });
    }
    const summary = await refreshOwnerNamedConvos({ limit, dryRun });
    return Response.json({ via: "local", ...summary });
  } catch (e) {
    console.error("[cron/zalo-refresh-names] 실패", e);
    return Response.json({ error: "대화명 보정에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
