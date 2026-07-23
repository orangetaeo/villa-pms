-- 2026-07-23 · T-seo-photo-roles — 사진 역할(외관·음식·내부·메뉴판)
--
-- additive only. 기존 사진은 kind NULL(미지정)로 남고, 미지정은 등록 순서대로 쓰인다.
BEGIN;

ALTER TABLE "SeoMedia" ADD COLUMN IF NOT EXISTS "kind" TEXT;
CREATE INDEX IF NOT EXISTS "SeoMedia_placeId_kind_idx" ON "SeoMedia"("placeId", "kind");

COMMIT;
