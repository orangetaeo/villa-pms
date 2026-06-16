"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /messages 자동 갱신 — RSC(서버 컴포넌트)는 수신 메시지를 폴링 없이는 모르므로
 * 주기적으로 router.refresh()해 인박스·대화 스레드를 새로 가져온다.
 * 탭이 백그라운드일 땐 폴링을 멈춰 불필요한 부하·발송량을 줄인다.
 * (실시간 SSE는 Phase 2 — 단순 폴링이 봇 1:N·관리자 소수 규모엔 충분)
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh(); // 탭 복귀 즉시 1회 갱신
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
