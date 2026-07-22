import type { MetadataRoute } from "next";

// PWA 웹 앱 매니페스트 (T-pwa-install) — 베트남 공급자 모바일 설치 지원
// 설치 경험 기준은 공급자(라이트 teal).
// ★ T-seo-s1: start_url을 "/" → "/login"으로 분리했다.
//   루트가 비로그인 방문자에게 **공개 마케팅 홈**을 렌더하도록 바뀌었기 때문에, start_url이 "/"이면
//   설치한 공급자가 앱을 열 때 로그인 대신 마케팅 홈을 보게 된다(베트남 공급자 UX 퇴행).
//   "/login"은 로그인 상태면 미들웨어가 역할별 홈으로 되돌려주므로 기존 경험이 그대로 보존된다.
//   scope는 "/" 유지 — 앱 내에서 공개 페이지로 이동해도 브라우저로 튕기지 않게 한다.
// 아이콘은 app/icon.svg(파비콘 겸용) 단일 소스 — sizes "any" + maskable 패딩.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Villa Go",
    short_name: "Villa Go",
    description: "푸꾸옥 빌라 임대 관리 시스템 — Quản lý villa Phú Quốc",
    lang: "vi",
    dir: "ltr",
    start_url: "/login",
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
