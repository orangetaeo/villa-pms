-- 2026-07-23 · T-blog-visual — 썸네일 + 상세페이지 HTML
BEGIN;
ALTER TABLE "SeoArticle" ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT;
ALTER TABLE "SeoArticle" ADD COLUMN IF NOT EXISTS "bodyHtml" TEXT;
COMMIT;
