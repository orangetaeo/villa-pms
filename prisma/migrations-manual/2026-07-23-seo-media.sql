-- 2026-07-23 · T-seo-media-library — 가이드 글 자료 사진 라이브러리
--
-- additive only. 기존 테이블·컬럼 변경 없음(SeoArticle은 손대지 않는다).
-- 적용 후 `npx prisma generate` 필수.
BEGIN;

CREATE TABLE IF NOT EXISTS "SeoMedia" (
  "id"         TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "alt"        TEXT NOT NULL,
  "caption"    TEXT,
  "credit"     TEXT,
  "topicKeys"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "usedCount"  INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "uploadedBy" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoMedia_pkey" PRIMARY KEY ("id")
);

-- 선택 쿼리 축: active=true 중 덜 쓴 사진 우선(usedCount asc)
CREATE INDEX IF NOT EXISTS "SeoMedia_active_usedCount_idx" ON "SeoMedia"("active", "usedCount");

COMMIT;
