import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // zca-js는 네이티브/ws 의존 — 서버 번들에서 제외하여 번들링 충돌 회피 (ADR-0006 S2).
  // (Next 15: instrumentation.ts는 기본 활성, serverExternalPackages는 stable)
  serverExternalPackages: ["zca-js"],
  // 전역 HTTP 보안 헤더 (T-sec-public-hardening, Phase 1 보안). CSP는 인라인/CDN 호환성
  // 검증 후 별도 추가(후속). Referrer-Policy는 공개 제안 URL의 token이 외부 referrer로
  // 새는 것을 차단하는 핵심 항목.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Railway HTTPS 전제 — 2년 + 서브도메인 (preload는 별도 등록 절차라 제외)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" }, // 클릭재킹 방어
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
      {
        protocol: "https",
        hostname: "**.r2.dev", // R2 공개 개발 도메인 (pub-xxx.r2.dev)
      },
      // 데모/파일럿 시드 placeholder 사진 (prisma/demo-seed.ts) — 실데이터 전환 시 제거 가능
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "fastly.picsum.photos", // picsum.photos 302 리다이렉트 대상
      },
    ],
  },
};

export default withNextIntl(nextConfig);
