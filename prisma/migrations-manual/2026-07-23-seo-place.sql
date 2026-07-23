-- 2026-07-23 · T-seo-place-article — 푸꾸옥 장소(맛집·카페·쇼핑) 소개 글
--
-- additive only. SeoMedia에 placeId 컬럼 1개 추가(널 허용) + SeoPlace 신규 테이블.
-- 적용 후 `npx prisma generate` 필수.
BEGIN;

CREATE TABLE IF NOT EXISTS "SeoPlace" (
  "id"              TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "nameLocal"       TEXT,
  "category"        TEXT NOT NULL,
  "area"            TEXT,
  "oneLiner"        TEXT NOT NULL,
  "tips"            TEXT,
  "mapUrl"          TEXT,
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "usedInArticleId" TEXT,
  "usedAt"          TIMESTAMP(3),
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoPlace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SeoPlace_active_category_idx" ON "SeoPlace"("active", "category");
CREATE INDEX IF NOT EXISTS "SeoPlace_usedInArticleId_idx" ON "SeoPlace"("usedInArticleId");

-- 장소 사진 연결 (기존 자료 사진은 placeId NULL 그대로 = 주제 태그용 일반 사진)
ALTER TABLE "SeoMedia" ADD COLUMN IF NOT EXISTS "placeId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SeoMedia_placeId_fkey') THEN
    ALTER TABLE "SeoMedia"
      ADD CONSTRAINT "SeoMedia_placeId_fkey"
      FOREIGN KEY ("placeId") REFERENCES "SeoPlace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "SeoMedia_placeId_idx" ON "SeoMedia"("placeId");

COMMIT;
