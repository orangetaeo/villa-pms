// Next.js instrumentation (ADR-0007 S1·S2 / ADR-0006 D1.1)
// 부팅 시 모든 활성 Zalo 계정(시스템봇 + 관리자 개인) 순차 자동 재로그인. Node 런타임에서만.
// credential은 DB에 영속 → 재배포/크래시 후 자동 복구. credential 없으면 조용히 종료.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // zca-js는 Node 전용(네이티브/ws). 동적 import로 Edge 번들 오염 방지.
    const { connectAllActive } = await import("./lib/zalo-runtime");
    // fire-and-forget — 부팅 블로킹 금지 (D1.1). 실패해도 큐는 보존되고 QR 재연결 가능.
    connectAllActive().catch((e) => {
      console.error(
        "[instrumentation] Zalo 멀티 계정 자동 재로그인 실패:",
        e instanceof Error ? e.message : e
      );
    });
  }
}
