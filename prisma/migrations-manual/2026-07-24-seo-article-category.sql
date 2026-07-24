-- 2026-07-24 · T-seo-category — 블로그 글(SeoArticle) 대분류 카테고리
--
-- additive only. category = "villa" | "service" | "place" | "guide"
--   (String + 화이트리스트 — 정본 lib/seo/categories.ts SEO_ARTICLE_CATEGORIES.
--    enum이 아닌 이유: 값 추가가 잦을 수 있어 ALTER TYPE 회피, SeoPlace.category 선례)
-- 백필 근거(topicKey 접두 규칙):
--   service-*                     → service (SERVICE_TOPICS 9종, service-article.ts)
--   place-<카테고리>-<회차>        → place   (placeTopicKey, place-article.ts)
--   villa-<빌라slug>              → villa   (villaTopicKey, article-draft.ts)
--   ARTICLE_TOPICS 8종 고정 키     → guide   (article-draft.ts)
-- ⚠ 가이드 주제 'villa-vs-hotel'이 villa- 접두와 겹친다 — villa 백필에서 가이드 키 8종을 제외한다.
-- 적용 후 `npx prisma generate` 필수.
BEGIN;

ALTER TABLE "SeoArticle" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'guide';

CREATE INDEX IF NOT EXISTS "SeoArticle_category_status_idx" ON "SeoArticle"("category", "status");

-- 백필 — 기존 행 분류. 어느 조건에도 안 걸리는 행은 DEFAULT 'guide' 유지.
UPDATE "SeoArticle" SET "category" = 'service' WHERE "topicKey" LIKE 'service-%';

UPDATE "SeoArticle" SET "category" = 'place' WHERE "topicKey" LIKE 'place-%';

UPDATE "SeoArticle" SET "category" = 'villa'
WHERE "topicKey" LIKE 'villa-%'
  AND "topicKey" NOT IN (
    'airport-transfer', 'season-guide', 'family-with-kids', 'villa-vs-hotel',
    'how-to-choose-villa', 'group-travel', 'golf-trip', 'food-and-market'
  );

UPDATE "SeoArticle" SET "category" = 'guide'
WHERE "topicKey" IN (
  'airport-transfer', 'season-guide', 'family-with-kids', 'villa-vs-hotel',
  'how-to-choose-villa', 'group-travel', 'golf-trip', 'food-and-market'
);

COMMIT;
