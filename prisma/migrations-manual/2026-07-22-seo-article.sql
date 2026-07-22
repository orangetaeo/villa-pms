-- T-seo-s3 — 공개 SEO 가이드 글 (additive only)
-- 적용 대상: Railway Postgres(라이브). prisma migrate dev·db push 금지 규약에 따른 raw SQL 정본.
-- 적용 후 반드시: npx prisma generate
--
-- 안전성: 신규 enum + 신규 테이블만. 기존 테이블 무변경.
-- ⚠ 배포 순서: 이 SQL을 라이브에 먼저 적용한 뒤 코드를 배포한다.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SeoArticleStatus') THEN
    CREATE TYPE "SeoArticleStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','PUBLISHED','REJECTED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "SeoArticle" (
  "id"              TEXT PRIMARY KEY,
  "slug"            TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "summary"         TEXT NOT NULL,
  "bodyJson"        JSONB NOT NULL,
  "topicKey"        TEXT NOT NULL,
  "coverPhotoUrl"   TEXT,
  "relatedVillaIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"          "SeoArticleStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedAt"      TIMESTAMP(3),
  "publishedAt"     TIMESTAMP(3),
  "lastPingAt"      TIMESTAMP(3),
  "rejectionReason" TEXT,
  "flaggedTerms"    JSONB,
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SeoArticle_slug_key" ON "SeoArticle"("slug");
CREATE INDEX IF NOT EXISTS "SeoArticle_status_publishedAt_idx" ON "SeoArticle"("status", "publishedAt");
CREATE INDEX IF NOT EXISTS "SeoArticle_topicKey_idx" ON "SeoArticle"("topicKey");
