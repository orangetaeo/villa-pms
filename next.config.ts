import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// CSP (Report-Only — T-sec-csp-report). 차단 없이 위반만 수집해 enforce 전 정책 정제.
// 실제 앱 소스 반영: Google Fonts(googleapis/gstatic), 이미지(R2·picsum·googleusercontent·data).
// script/style 'unsafe-inline'은 Next.js 인라인 부트스트랩용 — nonce화는 후속(middleware).
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  // challenges.cloudflare.com = Turnstile(웹챗 세션 생성 봇 차단). script/frame 양쪽 필요.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://*.r2.dev https://*.r2.cloudflarestorage.com https://picsum.photos https://fastly.picsum.photos https://lh3.googleusercontent.com https://*.zadn.vn",
  "connect-src 'self'",
  "report-uri /api/csp-report",
].join("; ");

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
          // 미사용 브라우저 기능 비활성화 (코드상 geolocation/getUserMedia 사용 0건 확인)
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // CSP는 Report-Only로 롤아웃 — 위반만 /api/csp-report로 수집, 앱 차단 없음 (enforce는 후속)
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
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
      // 데모 빌라 실사진 — Google Drive 공개 링크 CDN (07.빌라 > 푸꾸옥 빌라)
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      // ADR-0009 S6/D8.4 — Zalo 프로필 아바타 CDN. getAvatarUrlProfile 응답 호스트.
      // 실측 미확정: Zalo 아바타는 통상 s*-ava-talk.zadn.vn 등 *.zadn.vn 대역.
      // 운영에서 실제 호스트 확인 후 좁힐 것(현재는 *.zadn.vn 와일드카드). 만료 시 이니셜 폴백.
      {
        protocol: "https",
        hostname: "**.zadn.vn",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
