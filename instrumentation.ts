// Next.js instrumentation (ADR-0007 S1·S2 / ADR-0006 D1.1 / ADR-0032 BE-8)
// 부팅 시 모든 활성 Zalo 계정(시스템봇 + 관리자 개인) 순차 자동 재로그인. Node 런타임에서만.
// credential은 DB에 영속 → 재배포/크래시 후 자동 복구. credential 없으면 조용히 종료.
//
// ADR-0032 — ZALO_SESSION_LOCAL 가드:
//   · 기본(미설정) 또는 "true": 웹이 현행대로 세션을 보유(connectAllActive + 워치독). 동작 100% 보존.
//   · "false": 웹은 세션을 기동하지 않는다(세션 유일 보유자=zalo-worker). 대신 PG LISTEN relay만 상주해
//     워커의 NOTIFY 신호를 in-process 버스로 재-emit(SSE 무변경).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 기본 true(플래그 미설정 시 현행 동작 보존).
    const sessionLocal = process.env.ZALO_SESSION_LOCAL !== "false";

    if (sessionLocal) {
      // zca-js는 Node 전용(네이티브/ws). 동적 import로 Edge 번들 오염 방지.
      const { connectAllActive } = await import("./lib/zalo-runtime");
      // fire-and-forget — 부팅 블로킹 금지 (D1.1). 실패해도 큐는 보존되고 QR 재연결 가능.
      connectAllActive().catch((e) => {
        console.error(
          "[instrumentation] Zalo 멀티 계정 자동 재로그인 실패:",
          e instanceof Error ? e.message : e
        );
      });
      // 리스너 헬스 워치독(5분 주기) — 미연결 ≈10분+ 지속 시 운영자 인앱+Zalo 경보 (계약 zalo-health-alert).
      const { startZaloHealthWatchdog } = await import("./lib/zalo-health");
      startZaloHealthWatchdog();
    } else {
      // 세션 비보유 웹 — 워커 NOTIFY를 받는 LISTEN relay만 상주(워치독은 워커가 담당).
      const { startRealtimeListenRelay } = await import("./lib/realtime-notify");
      startRealtimeListenRelay();
      console.log("[instrumentation] ZALO_SESSION_LOCAL=false — 웹 세션 미기동, LISTEN relay 상주");
    }
  }
}
