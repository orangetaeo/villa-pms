// lib/seo/categories.ts — 블로그 글(SeoArticle) 대분류 카테고리 (T-seo-category)
//
// ★ 화이트리스트 정본 — DB(SeoArticle.category)는 String이라 여기 없는 값은 쓰지 않는다.
//   enum이 아닌 이유: 값 추가가 잦을 수 있어 `ALTER TYPE` 회피(SeoPlace.category·ContractNegotiation.clauseKey 선례).
//   생성 경로별 배정(고정):
//     villa   — 빌라 소개 글 (topicKey `villa-<빌라slug>`, cron seo-draft ①)
//     service — 부가서비스 글 (topicKey `service-*`, SERVICE_TOPICS 9종)
//     place   — 맛집·장소 글 (topicKey `place-<카테고리>-<회차>`)
//     guide   — 여행 가이드 글 (ARTICLE_TOPICS 8종 — 내부 세분류 없음, 테오 확정 2026-07-24)
//     video   — 개별 영상 글 (topicKey `video-<youtubeShortId>`, cron seo-draft ⑤, ADR-0049)
//   ⚠ topicKey 접두로 역산하지 말 것: 가이드 주제 `villa-vs-hotel`이 `villa-` 접두와 겹친다.
//     카테고리는 생성 시점에 명시적으로 세팅한다(각 create 호출부).
export const SEO_ARTICLE_CATEGORIES = ["villa", "service", "place", "guide", "video"] as const;

export type SeoArticleCategory = (typeof SEO_ARTICLE_CATEGORIES)[number];

export function isSeoArticleCategory(v: string): v is SeoArticleCategory {
  return (SEO_ARTICLE_CATEGORIES as readonly string[]).includes(v);
}

/** 화면 라벨 — 운영자(ko)·공급자(vi) 양쪽에서 재사용. FE/LOC는 이 매핑만 import한다. */
export const SEO_ARTICLE_CATEGORY_LABELS: Record<SeoArticleCategory, { ko: string; vi: string }> = {
  villa: { ko: "빌라", vi: "Biệt thự" },
  service: { ko: "서비스", vi: "Dịch vụ" },
  place: { ko: "맛집·장소", vi: "Quán ăn · Địa điểm" },
  guide: { ko: "여행 가이드", vi: "Cẩm nang du lịch" },
  video: { ko: "영상", vi: "Video" },
};

export function seoArticleCategoryLabel(category: SeoArticleCategory, locale: "ko" | "vi" = "ko"): string {
  return SEO_ARTICLE_CATEGORY_LABELS[category][locale];
}
