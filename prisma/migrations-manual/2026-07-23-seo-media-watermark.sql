-- 2026-07-23 · T-blog-visual — 블로그 이미지 워터마크 파생본 캐시
BEGIN;
ALTER TABLE "SeoMedia" ADD COLUMN IF NOT EXISTS "watermarkedUrl" TEXT;
COMMIT;
