-- 2026-07-16 — 인스타그램 자동 포스팅 Phase 1 (additive, 계약서 instagram-marketing-p1)
-- InstagramPost + enum IgPostKind/IgPostStatus. InstagramMessage(DM)는 Phase 2.
-- villaId FK = ON DELETE SET NULL — 빌라 삭제 시 발행 이력(permalink) 보존.
-- 신규 enum이므로 CREATE TYPE — idempotent 위해 DO 블록 duplicate_object 흡수 (Postgres에 CREATE TYPE IF NOT EXISTS 없음).

DO $$ BEGIN
  CREATE TYPE "IgPostKind" AS ENUM ('VILLA_SHOWCASE', 'SERVICE', 'INFO', 'REELS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "IgPostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "InstagramPost" (
  "id" TEXT NOT NULL,
  "villaId" TEXT,
  "kind" "IgPostKind" NOT NULL,
  "status" "IgPostStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "caption" TEXT NOT NULL,
  "mediaJson" JSONB NOT NULL,
  "igMediaId" TEXT,
  "igPermalink" TEXT,
  "publishedAt" TIMESTAMP(3),
  "failReason" TEXT,
  "flaggedTerms" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InstagramPost_villaId_fkey" FOREIGN KEY ("villaId") REFERENCES "Villa"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "InstagramPost_status_scheduledAt_idx" ON "InstagramPost"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "InstagramPost_villaId_idx" ON "InstagramPost"("villaId");
