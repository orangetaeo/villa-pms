-- 후속 2건(인앱 알림센터 + 일정 협의) additive 마이그레이션 — 공유 Neon 직접 적용용.
-- ★ enum 변경 없음(드리프트 회피). 새 테이블 + nullable 컬럼만 → 기존 코드/세션 무영향. 멱등(IF NOT EXISTS).
-- 롤백: DROP TABLE "InAppNotification"; ALTER TABLE "ServiceOrder" DROP COLUMN ...4개;

-- ① 일정 협의: ServiceOrder 제안 필드 4개
ALTER TABLE "ServiceOrder"
  ADD COLUMN IF NOT EXISTS "proposedServiceDate" date,
  ADD COLUMN IF NOT EXISTS "proposedServiceTime" text,
  ADD COLUMN IF NOT EXISTS "vendorProposalNote" text,
  ADD COLUMN IF NOT EXISTS "vendorProposalRespondedAt" timestamp(3);

-- ② 인앱 알림센터: InAppNotification 테이블
CREATE TABLE IF NOT EXISTS "InAppNotification" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "href" text,
  "readAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InAppNotification_userId_readAt_idx" ON "InAppNotification" ("userId", "readAt");
CREATE INDEX IF NOT EXISTS "InAppNotification_userId_createdAt_idx" ON "InAppNotification" ("userId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "InAppNotification"
    ADD CONSTRAINT "InAppNotification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
