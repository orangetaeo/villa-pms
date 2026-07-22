// lib/seo/base-url.ts — 공개 절대 URL 단일 해석기 (T-seo-s1)
//
// sitemap·RSS·canonical·OG·IndexNow 핑이 전부 **같은 호스트**를 써야 한다.
// 여기서 갈리면 색인이 두 도메인으로 쪼개지고(중복 콘텐츠), IndexNow는 호스트 불일치로 거부된다.
//
// 우선순위: SEO_PUBLIC_BASE_URL > VILLA_PUBLIC_BASE_URL(기존 Zalo 링크용) > NEXTAUTH_URL > 기본값
// (기존 코드가 VILLA_PUBLIC_BASE_URL을 쓰고 있어 재사용한다 — 진실 이중화 방지)

const DEFAULT_BASE = "https://villa-go.net";

/** 후행 슬래시 없는 origin. 예: https://villa-go.net */
export function seoBaseUrl(): string {
  const raw =
    process.env.SEO_PUBLIC_BASE_URL ||
    process.env.VILLA_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    DEFAULT_BASE;
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_BASE;
}

/** 경로 → 절대 URL. path는 항상 "/"로 시작해야 한다. */
export function absoluteUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${seoBaseUrl()}${p}`;
}
