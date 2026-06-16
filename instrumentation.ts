// Next.js instrumentation (ADR-0006 S2 / D1.1)
// 부팅 시 1회 Zalo 봇 자동 재로그인. Node 런타임에서만 (Edge/빌드 제외).
// credential은 DB에 영속 → 재배포/크래시 후 자동 복구. credential 없으면 connectBot()이 조용히 종료.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // zca-js는 Node 전용(네이티브/ws). 동적 import로 Edge 번들 오염 방지.
    const { connectBot } = await import("./lib/zalo-runtime");
    // fire-and-forget — 부팅 블로킹 금지 (D1.1). 실패해도 큐는 보존되고 QR 재연결 가능.
    connectBot().catch((e) => {
      console.error(
        "[instrumentation] Zalo 봇 자동 재로그인 실패:",
        e instanceof Error ? e.message : e
      );
    });
  }
}
