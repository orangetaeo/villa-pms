import type { MetadataRoute } from "next";

// PWA 웹 앱 매니페스트 (T-pwa-install) — 베트남 공급자 모바일 설치 지원
// 설치 경험 기준은 공급자(라이트 teal) — start_url은 루트(/)에서 role 분기.
// 아이콘은 app/icon.svg(파비콘 겸용) 단일 소스 — sizes "any" + maskable 패딩.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Villa PMS Phu Quoc",
    short_name: "Villa PMS",
    description: "푸꾸옥 빌라 임대 관리 시스템 — Quản lý villa Phú Quốc",
    lang: "vi",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F8FAFC",
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
