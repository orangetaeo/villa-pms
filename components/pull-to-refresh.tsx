"use client";

// 모바일 당겨서 새로고침(Pull-to-Refresh) — admin·공급자 공용.
// RSC(서버 컴포넌트) 목록·상세는 폴링 없이는 갱신되지 않으므로, 화면 최상단에서
// 아래로 당기면 router.refresh()로 서버 데이터를 다시 가져온다.
// - 데스크톱(≥1024px)·풀스크린 라우트(내부 스크롤 플로우)에선 비활성.
// - 터치 시작 지점의 스크롤 조상이 모두 최상단일 때만 발동(내부 스크롤 영역 오작동 방지).
// - 당기는 동안 네이티브 브라우저 새로고침은 preventDefault로 억제하고 자체 인디케이터를 표시.
// 테마: admin=다크(dark), 공급자=라이트(light).

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

const THRESHOLD = 70; // 새로고침 발동 당김 거리(px)
const MAX_PULL = 110; // 인디케이터 최대 이동(px)
const RESISTANCE = 0.5; // 당김 감쇠(고무줄 느낌)
const BADGE = 36; // 인디케이터 지름(px) — 시작 시 화면 위로 숨김

const THEME = {
  dark: "bg-admin-card text-admin-primary ring-1 ring-white/10",
  light: "bg-white text-teal-600 ring-1 ring-black/5",
} as const;

export default function PullToRefresh({
  /** 비활성화할 풀스크린 라우트 접두사(내부 스크롤 플로우) */
  fullscreenPrefixes = [],
  /** 인디케이터 테마 — admin 다크 / 공급자 라이트 */
  variant = "dark",
}: {
  fullscreenPrefixes?: string[];
  variant?: keyof typeof THEME;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 핸들러 안에서 최신 값을 읽되 리스너 재등록은 막기 위해 ref 병행
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const activeRef = useRef(false);
  const startYRef = useRef(0);

  const setPullVal = (v: number) => {
    pullRef.current = v;
    setPull(v);
  };

  const disabled = fullscreenPrefixes.some((p) => pathname.startsWith(p));

  // 새로고침(전환) 완료 시 인디케이터 정리
  useEffect(() => {
    if (refreshing && !isPending) {
      const t = window.setTimeout(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        setPullVal(0);
      }, 300);
      return () => window.clearTimeout(t);
    }
  }, [refreshing, isPending]);

  useEffect(() => {
    if (disabled) return;

    // 터치 지점부터 스크롤 가능한 조상이 모두 최상단인지(자체 스크롤 영역 보호)
    const atTop = (target: EventTarget | null) => {
      let el = target as HTMLElement | null;
      while (el && el !== document.body && el !== document.documentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollTop > 0) return false;
        el = el.parentElement;
      }
      return window.scrollY <= 0;
    };

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return;
      if (window.innerWidth >= 1024) return; // 모바일 전용
      if (!atTop(e.target)) return;
      startYRef.current = e.touches[0].clientY;
      activeRef.current = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!activeRef.current || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        if (pullRef.current !== 0) setPullVal(0);
        return;
      }
      if (!dragging) setDragging(true);
      setPullVal(Math.min(MAX_PULL, dy * RESISTANCE));
      // 아래로 당기는 중 — 네이티브 오버스크롤/새로고침 억제
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      setDragging(false);
      if (pullRef.current >= THRESHOLD) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPullVal(THRESHOLD);
        startTransition(() => router.refresh());
      } else {
        setPullVal(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
    // dragging은 onMove 첫 프레임 분기에만 쓰여 재등록돼도 무해
  }, [disabled, dragging, router]);

  if (disabled) return null;

  const spinning = refreshing || isPending;
  const offset = (spinning ? THRESHOLD : pull) - BADGE - 8;
  const visible = pull > 0 || spinning;

  return (
    <div
      aria-hidden
      className={`lg:hidden fixed left-1/2 top-0 z-[60] flex items-center justify-center rounded-full shadow-lg pointer-events-none ${THEME[variant]}`}
      style={{
        height: BADGE,
        width: BADGE,
        transform: `translate(-50%, ${offset}px)`,
        opacity: visible ? 1 : 0,
        transition: dragging ? "none" : "transform 0.2s ease, opacity 0.2s ease",
      }}
    >
      <span
        className={`material-symbols-outlined text-[20px] ${spinning ? "animate-spin" : ""}`}
        style={
          spinning
            ? undefined
            : { transform: `rotate(${Math.min(180, (pull / THRESHOLD) * 180)}deg)` }
        }
      >
        {spinning ? "progress_activity" : "arrow_downward"}
      </span>
    </div>
  );
}
