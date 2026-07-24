"use client";

// 웹챗 위젯 마운트 (T-webchat-expand §B) — 공개 라우트 전용.
//
// ⚠ 절대 규칙: 이 컴포넌트는 admin·supplier·vendor·partner 레이아웃에 절대 넣지 않는다.
//   전역 자동 마운트가 아니라 부착이 승인된 레이아웃(/g·/p·(auth))에서만 명시적으로 렌더한다.
//   → admin/공급자 화면에 위젯이 뜨지 않음이 "사용처 한정"으로 구조적으로 보장된다.
//
// 로더(public/webchat-loader.js)는 Next 동적 주입 시 document.currentScript=null이라
//   data-page 속성을 읽지 못한다. 그래서 전역(window.__VG_WEBCHAT_PAGE)을 로더보다 먼저 세팅한다.
//   로더는 1회만 주입(중복 가드) — 클라 내비게이션으로 재마운트돼도 스크립트는 한 번만 붙는다.
import { useEffect } from "react";

// 로더 버전 — intro 3종 HTML의 ?v= 와 반드시 동기(CF 엣지 캐시버스팅, 기획 §9).
const LOADER_VERSION = "20260724a";

declare global {
  interface Window {
    __VG_WEBCHAT_PAGE?: string;
    __VG_WEBCHAT_OFFSET?: number;
    __villaWebChatLoaded?: boolean;
  }
}

export default function WebchatMount({ page, offset }: { page: string; offset?: number }) {
  useEffect(() => {
    // 전역 먼저 세팅(로더 IIFE가 이 값을 sourcePage로 읽음).
    window.__VG_WEBCHAT_PAGE = page;
    if (typeof offset === "number" && offset > 0) {
      window.__VG_WEBCHAT_OFFSET = offset;
    }

    // 1회 주입 — 이미 로드됐거나 태그가 있으면 재주입하지 않는다.
    if (window.__villaWebChatLoaded) return;
    if (document.querySelector("script[data-vg-webchat]")) return;

    const s = document.createElement("script");
    s.src = `/webchat-loader.js?v=${LOADER_VERSION}`;
    s.async = true;
    s.setAttribute("data-vg-webchat", "1");
    s.setAttribute("data-page", page); // currentScript 지원 환경용 보조(전역이 주 경로)
    document.body.appendChild(s);
  }, [page, offset]);

  return null;
}
