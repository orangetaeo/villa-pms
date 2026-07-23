-- 2026-07-23 · T-seo-ux-fix — 발행된 글 노출/비노출 토글
--
-- additive only. 기존 글은 전부 노출 상태(false)로 시작한다.
-- 적용 후 `npx prisma generate` 필수.
BEGIN;

ALTER TABLE "SeoArticle" ADD COLUMN IF NOT EXISTS "publicHidden" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
