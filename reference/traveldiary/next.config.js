// [SHARED-MODULE] from traveldiary-mvp next.config.js
/** @type {import('next').NextConfig} */

// 사이클 11d/B (S-11 §5) — 보안 헤더
// CSP 정책 (v2.1 보안 강화)
// - 'unsafe-inline' for scripts: SW 등록 inline + Next.js hydration
// - 'unsafe-inline' for styles: Tailwind + style prop
// - 외부 출처: Google Maps embed, CDN 폰트, picsum(시드 이미지)
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://picsum.photos https://fastly.picsum.photos https://maps.googleapis.com",
  "frame-src https://www.google.com https://maps.google.com",
  "connect-src 'self' https://maps.googleapis.com https://openapi.naver.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // ADR-017 — geolocation은 self-only (5b-4 자동 모드 전환)
    // ADR-019 — camera는 self-only (M4 카메라 번역, 5b-5+)
    value: "camera=(self), geolocation=(self), microphone=()",
  },
  {
    key: "Content-Security-Policy",
    value: cspDirectives,
  },
];

// CDN 캐시 헤더 (런치 체크리스트 §📊 성능)
// Next.js 빌드 해시 포함 정적 에셋은 immutable 장기 캐시.
// OG 이미지·share 페이지는 stale-while-revalidate로 빠른 응답 + 백그라운드 갱신.
const cacheRules = [
  {
    // Next.js 빌드 에셋 (_next/static) — 해시 기반 immutable
    source: "/_next/static/:path*",
    headers: [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ],
  },
  {
    // 폰트·아이콘 정적 파일
    source: "/fonts/:path*",
    headers: [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ],
  },
  {
    // favicon, manifest 등 루트 정적 파일
    source: "/:file(favicon.ico|site.webmanifest|robots.txt|manifest.json)",
    headers: [
      {
        key: "Cache-Control",
        value: "public, max-age=86400, stale-while-revalidate=604800",
      },
    ],
  },
  {
    // OG 이미지 — 1h 브라우저 + 24h CDN + 7일 stale
    source: "/api/og/:path*",
    headers: [
      {
        key: "Cache-Control",
        value:
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    ],
  },
  {
    // 공유 페이지 — 짧은 캐시 + stale (편집 반영 속도 vs 성능 균형)
    source: "/share/:path*",
    headers: [
      {
        key: "Cache-Control",
        value:
          "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
      },
    ],
  },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // 영수증 이미지 base64 전송 허용
    },
  },
  async headers() {
    return [
      // 보안 헤더 — 모든 경로
      { source: "/:path*", headers: securityHeaders },
      // CDN 캐시 헤더 — 경로별 차등
      ...cacheRules,
    ];
  },
};

module.exports = nextConfig;
