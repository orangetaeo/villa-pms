"use client";

import { useEffect, useRef } from "react";

/**
 * T-splash-intro — villa-go.net 최초 진입 핀 드롭 스플래시 인트로.
 *
 * 렌더 구조: 이 컴포넌트가 #vg-splash 오버레이 전체(무대·SVG·워드마크·태그라인)를
 * 렌더한다. 조건부 렌더 없음(서버·클라 동일 마크업 → 하이드레이션 미스매치 0).
 * 표시 여부는 오직 CSS `html[data-splash="1"] #vg-splash`가 결정(기본 display:none).
 *
 * 타임라인·스킵 로직: CSS 키프레임은 data-splash 세팅 시 자동 시작하므로 JS는 종료만 관리.
 *  - 정상 종료: 1.6s(애니메이션 끝)
 *  - 하드 상한: 2.2s
 *  - 즉시 스킵: 오버레이 pointerdown / window keydown / visibilitychange(hidden)
 * 종료 시점에 sessionStorage 기록(마운트 시점 금지 — /logout 중간 홉이 1회분을 소진하면 안 됨).
 */

// 흰 지도핀 물방울 실루엣 (viewBox 200×300, 팁 = (100,246))
const PIN_PATH =
  "M100,12 C58,12 26,44 26,90 C26,140 78,196 96,240 C98,246 102,246 104,240 C122,196 174,140 174,90 C174,44 142,12 100,12 Z";

export default function SplashIntro({ tagline }: { tagline: string }) {
  const doneRef = useRef(false);

  useEffect(() => {
    const html = document.documentElement;
    // 게이트가 안 걸렸으면(이미 본 세션·reduced-motion·제외경로) 아무것도 안 함.
    if (html.getAttribute("data-splash") !== "1") return;

    const timers: number[] = [];

    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      html.removeAttribute("data-splash");
      // 완료/스킵 "시점"에 기록 — 세션당 1회.
      try {
        sessionStorage.setItem("vg-splash", "1");
      } catch {
        /* storage 접근 불가 시 무시 */
      }
      window.removeEventListener("keydown", finish);
      document.removeEventListener("visibilitychange", onVisibility);
      timers.forEach((t) => window.clearTimeout(t));
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") finish();
    };

    // 정상 종료(애니메이션 끝) + 하드 상한 이중 방어.
    timers.push(window.setTimeout(finish, 1600));
    timers.push(window.setTimeout(finish, 2200));
    window.addEventListener("keydown", finish);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("keydown", finish);
      document.removeEventListener("visibilitychange", onVisibility);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const onPointerDown = () => {
    // 오버레이 어디든 눌러 즉시 스킵.
    document.documentElement.removeAttribute("data-splash");
    if (!doneRef.current) {
      doneRef.current = true;
      try {
        sessionStorage.setItem("vg-splash", "1");
      } catch {
        /* 무시 */
      }
    }
  };

  return (
    <div id="vg-splash" aria-hidden="true" onPointerDown={onPointerDown}>
      <div className="vg-stage">
        <div className="vg-pinwrap">
          <div className="vg-shadow" />
          <div className="vg-ring" />
          <div className="vg-logo">
            <svg
              className="vg-svg"
              viewBox="0 0 200 300"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="Villa GO"
            >
              {/* ① 흰색 지도핀 실루엣 */}
              <path className="vg-pin" d={PIN_PATH} fill="#ffffff" />
              {/* ② 핀 안 티얼 집 (경사지붕 + 몸체) */}
              <g className="vg-house" fill="#12857A">
                {/* 경사지붕 (처마 오버행) */}
                <polygon points="100,50 150,92 132,92 132,88 68,88 68,92 50,92" />
                {/* 몸체 */}
                <rect x="70" y="88" width="60" height="52" />
              </g>
              {/* 흰 문 */}
              <path
                className="vg-door"
                d="M90,140 L90,116 a10,10 0 0 1 20,0 L110,140 Z"
                fill="#ffffff"
              />
              {/* ③ 오렌지 지붕점 */}
              <circle className="vg-dot" cx="100" cy="76" r="9" fill="#F5A11C" />
            </svg>
          </div>
        </div>

        <div className="vg-wordmark">
          <span className="vg-word-villa">Villa</span>
          <span className="vg-word-go">GO</span>
        </div>
        <div className="vg-tagline">{tagline}</div>
      </div>
    </div>
  );
}
