// lib/seo/routes.ts — 공개 트리 경로 **단일 원천** (T-seo-s1)
//
// robots.ts · sitemap.ts · 스플래시 게이트 · 미들웨어가 전부 이 상수를 참조한다.
// 경로를 한 곳에서만 정의해야 "robots에는 열려 있는데 미들웨어가 막는" 종류의 사고가 안 난다.
//
// ★ 경로 선정 근거: `/villas`는 이미 **운영자 빌라 목록 URL**이다(app/(admin)/villas).
//   공개 소비자 트리를 같은 경로에 둘 수 없으므로 전부 `/blog` 아래로 모은다.
//   테오가 부르는 이름("/blog")과도 일치하고, 운영자 라우트와 충돌 위험이 0이다.

/** 공개 콘텐츠 루트 */
export const BLOG_ROOT = "/blog";

/**
 * 공개 트리 URL 구조 — 소비자 검색형(패싯 SEO).
 *   /blog                              허브(최신 글 + 조건별 진입 + 추천 빌라)
 *   /blog/villa/[slug]                 빌라 상세
 *   /blog/area/[code]                  지역·단지별      ← ComplexArea.code
 *   /blog/feature/[key]                이용시설·특징별   ← FEATURE_ITEMS 사전
 *   /blog/guests/[n]                   인원별
 *   /blog/bedrooms/[n]                 침실 수별
 *   /blog/area/[code]/feature/[key]    2단 조합(화이트리스트만 sitemap 등재)
 *   /blog/[slug]                       가이드 글
 */
export const blogPaths = {
  hub: () => BLOG_ROOT,
  villa: (slug: string) => `${BLOG_ROOT}/villa/${slug}`,
  area: (code: string) => `${BLOG_ROOT}/area/${code}`,
  feature: (key: string) => `${BLOG_ROOT}/feature/${key}`,
  guests: (n: number) => `${BLOG_ROOT}/guests/${n}`,
  bedrooms: (n: number) => `${BLOG_ROOT}/bedrooms/${n}`,
  areaFeature: (code: string, key: string) => `${BLOG_ROOT}/area/${code}/feature/${key}`,
  article: (slug: string) => `${BLOG_ROOT}/${slug}`,
} as const;

/**
 * 크롤러에게 열어주는 경로(접두사). 루트(`/`)는 공개 홈이 배포된 뒤에도 계속 열려 있어야 한다.
 * ⚠ 여기에 경로를 추가할 때는 그 경로가 **정말로 비로그인 200**인지 먼저 확인할 것.
 *   로그인 리다이렉트가 걸린 경로를 allow 하면 크롤 예산만 낭비하고 색인은 안 된다.
 */
export const PUBLIC_ALLOW_PATHS = [
  "/",
  BLOG_ROOT,
  "/privacy",
  // 모집용 정적 소개(공급자·벤더·파트너) — 검색 유입이 이득이라 색인 허용
  "/intro.html",
  "/intro-vendor.html",
  "/intro-partner.html",
] as const;

/**
 * 색인 금지 — 운영자·공급자·인증·토큰 경로 전부.
 * ★ `/p/`(제안링크)·`/g/`(게스트링크)는 토큰 URL이라 색인되면 예약 정보가 통째로 샌다.
 *   robots + 페이지 `noindex` 메타 **이중 차단**이 원칙(robots는 크롤 억제일 뿐 색인 보장이 아님).
 * ★ `/card/`(명함)는 개인 실명·연락처가 있는 공개 SSG — 링크·QR 직접 전달 용도이므로 noindex.
 */
export const PUBLIC_DISALLOW_PATHS = [
  "/api/",
  // 운영자 (app/(admin)/*)
  "/account",
  "/activity",
  "/availability",
  "/bookings",
  "/contracts",
  "/cost-alerts",
  "/dashboard",
  "/documents",
  "/inspections",
  "/inventory",
  "/marketing",
  "/messages",
  "/partners",
  "/proposals",
  "/receivables",
  "/revenue",
  "/service-orders",
  "/settings",
  "/settlements",
  "/statistics",
  "/users",
  "/villas", // 운영자 빌라 목록 — 공개 빌라는 /blog/villa/*
  // 공급자·청소 (app/(supplier)/*)
  "/calendar",
  "/cleaning",
  "/contract",
  "/earnings",
  "/guide",
  "/my-bookings",
  "/my-villas",
  "/profile",
  "/zalo-connect",
  // 인증
  "/login",
  "/logout",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/vendor",
  "/vendor-signup",
  // 토큰·세션 경로 (색인 시 개인정보·예약정보 누출)
  "/p/",
  "/g/",
  "/webchat",
  "/chat",
  "/uploads/",
  // 개인 실명·연락처 (명함)
  "/card/",
] as const;

/** 해당 경로가 공개 트리인지 — 스플래시 게이트·미들웨어가 공유한다. */
export function isPublicSeoPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return pathname === BLOG_ROOT || pathname.startsWith(`${BLOG_ROOT}/`);
}
