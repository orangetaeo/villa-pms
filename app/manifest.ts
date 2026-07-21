import type { MetadataRoute } from "next";

// PWA 웹 앱 매니페스트 (T-pwa-install) — 베트남 공급자 모바일 설치 지원
// 설치 경험 기준은 공급자(라이트 teal) — start_url은 루트(/)에서 role 분기.
// 아이콘은 app/icon.svg(파비콘 겸용) 단일 소스 — sizes "any" + maskable 패딩.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Villa Go",
    short_name: "Villa Go",
    description: "푸꾸옥 빌라 임대 관리 시스템 — Quản lý villa Phú Quốc",
    lang: "vi",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // background_color = 안드로이드/데스크톱 설치 PWA의 네이티브 런치 스플래시 배경.
    // theme_color(teal)와 동일하게 맞춰 [런치 스플래시(teal) → 인앱 인트로(teal)]를 이음매 없이 연결.
    // (과거 #F8FAFC 흰색 → 인트로 전 흰 화면이 보이던 문제 제거. 아이콘 teal 타일이 이 배경에 녹아 흰 핀만 부각 — 인트로와 동일 컨셉.)
    background_color: "#0D9488",
    theme_color: "#0D9488",
    icons: [
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "maskable",
      },
    ],
  };
}
