-- 2026-07-23 · T-seo-to-instagram S2 — 장소 글을 유튜브 쇼츠 소재로
--
-- additive only. enum 값 추가 + 컬럼 1개 + FK + 인덱스.
-- ★ enum 값 추가는 트랜잭션 밖에서(구 Postgres 호환) — ADD VALUE IF NOT EXISTS.
ALTER TYPE "YtSourceType" ADD VALUE IF NOT EXISTS 'PLACE_AUTO';

ALTER TABLE "YoutubeShort" ADD COLUMN IF NOT EXISTS "seoArticleId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'YoutubeShort_seoArticleId_fkey') THEN
    ALTER TABLE "YoutubeShort"
      ADD CONSTRAINT "YoutubeShort_seoArticleId_fkey"
      FOREIGN KEY ("seoArticleId") REFERENCES "SeoArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "YoutubeShort_seoArticleId_idx" ON "YoutubeShort"("seoArticleId");
