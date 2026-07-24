// lib/seo/article-jsonld.ts — 블로그 글 상세의 구조화 데이터 빌더(순수 함수, 서버/클라 무관)
//
// ★ author / BreadcrumbList는 검색엔진 품질 신호(E-E-A-T·사이트 구조)라 형태가 어긋나면 리치결과 자격을
//   잃는다. page.tsx 인라인으로 두면 검증이 어려워, **순수 함수로 분리**해 유닛 테스트로 고정한다.
// ★ 실명 노출 금지(익명 원칙): 저자는 개인이 아니라 브랜드 에디토리얼 주체(Villa GO)다.
import { absoluteUrl, seoBaseUrl } from "@/lib/seo/base-url";
import { blogPaths, BLOG_ROOT } from "@/lib/seo/routes";
import { seoArticleCategoryLabel, type SeoArticleCategory } from "@/lib/seo/categories";

/** Article.author — 화면 바이라인("Villa GO 현지 에디터")과 동일 주체. */
export const ARTICLE_AUTHOR_LD = {
  "@type": "Organization" as const,
  name: "Villa GO",
  url: seoBaseUrl(),
};

/** 화면 바이라인 문구 — JSON-LD author와 한 곳에서 관리(스키마=화면 일치). */
export const ARTICLE_BYLINE = "Villa GO 현지 에디터 · 직접 방문 후 작성";

/** 브레드크럼 한 계층(홈)의 표시 라벨 — 화면 nav와 공유. */
export const BREADCRUMB_HOME_LABEL = "푸꾸옥 여행 가이드";

/**
 * VideoObject — 개별 영상 글(category="video")의 구조화 데이터(ADR-0049 §6).
 * 기존 Article JSON-LD와 **병기**한다(둘 다 같은 페이지에 나온다). 구글 비디오 리치결과 자격 신호.
 *
 * ★ 순수 함수 — durationSec는 호출부(page)가 원천 쇼츠(YoutubeShort)에서 별도 조회해 넘긴다.
 *   durationSec가 null·0이면 **duration 필드 자체를 생략**한다(PT0S 같은 거짓 값 금지 — ADR-0049 §6).
 * ★ 실명 노출 금지 승계: name=글 title(이미 publicVillaLabel 경유), description=글 summary(공개 필드).
 * ★ thumbnailUrl = 커버(R2 posterUrl, https 절대경로) → 없거나 자사 정적 폴백이면 유튜브 썸네일.
 *   (sitemap-video.xml의 thumbnail_loc 폴백 규칙과 동일하게 맞춘다.)
 */
export function buildVideoObjectLd(input: {
  title: string;
  summary: string;
  slug: string;
  ytVideoId: string;
  coverPhotoUrl: string | null;
  publishedAt: Date;
  durationSec: number | null;
}) {
  const thumbnailUrl =
    input.coverPhotoUrl && input.coverPhotoUrl.startsWith("https://")
      ? input.coverPhotoUrl
      : `https://i.ytimg.com/vi/${input.ytVideoId}/hqdefault.jpg`;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: input.title,
    description: input.summary,
    thumbnailUrl,
    uploadDate: input.publishedAt.toISOString(),
    // 재생 전 추적 없는 임베드(youtube-nocookie) — 화면 렌더(article-body.tsx)와 동일 도메인.
    embedUrl: `https://www.youtube-nocookie.com/embed/${input.ytVideoId}`,
    mainEntityOfPage: absoluteUrl(blogPaths.article(input.slug)),
  };
  // 조회 가능·양수일 때만 ISO8601(PT#S). 그 외엔 필드를 아예 넣지 않는다.
  if (typeof input.durationSec === "number" && input.durationSec > 0) {
    ld.duration = `PT${Math.round(input.durationSec)}S`;
  }
  return ld;
}

/**
 * BreadcrumbList — 가이드(홈) → 카테고리 → 현재 글. position은 1..n 연속.
 * ★ 화면 브레드크럼과 **동일 계층**을 반환한다(스키마가 화면에 없는 계층을 지어내지 않게).
 */
export function buildBreadcrumbLd(article: { slug: string; title: string; category: SeoArticleCategory }) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: BREADCRUMB_HOME_LABEL, item: absoluteUrl(BLOG_ROOT) },
      {
        "@type": "ListItem",
        position: 2,
        name: seoArticleCategoryLabel(article.category),
        item: absoluteUrl(blogPaths.categoryList(article.category)),
      },
      { "@type": "ListItem", position: 3, name: article.title, item: absoluteUrl(blogPaths.article(article.slug)) },
    ],
  };
}
