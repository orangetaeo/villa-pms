import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // zca-js는 네이티브/ws 의존 — 서버 번들에서 제외하여 번들링 충돌 회피 (ADR-0006 S2).
  // (Next 15: instrumentation.ts는 기본 활성, serverExternalPackages는 stable)
  serverExternalPackages: ["zca-js"],
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
