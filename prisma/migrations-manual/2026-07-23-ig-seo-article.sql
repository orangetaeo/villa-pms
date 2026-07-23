-- 2026-07-23 · T-seo-to-instagram — 장소 글을 인스타 소재로 재사용
--
-- additive only. 컬럼 1개 + FK + 인덱스. 기존 포스트는 seoArticleId NULL 그대로.
BEGIN;

ALTER TABLE "InstagramPost" ADD COLUMN IF NOT EXISTS "seoArticleId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InstagramPost_seoArticleId_fkey') THEN
    ALTER TABLE "InstagramPost"
      ADD CONSTRAINT "InstagramPost_seoArticleId_fkey"
      FOREIGN KEY ("seoArticleId") REFERENCES "SeoArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "InstagramPost_seoArticleId_idx" ON "InstagramPost"("seoArticleId");

COMMIT;
