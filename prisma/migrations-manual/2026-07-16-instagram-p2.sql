-- 2026-07-16 — 인스타그램 Phase 2 (additive, 계약서 instagram-marketing-p2)
-- ① InstagramMessage(DM 인박스) + enum IgMsgDirection
-- ② InstagramInsightSnapshot(일별 인사이트 스냅샷 — 추이 정본) + enum IgInsightScope
-- ③ InstagramPost 인사이트 캐시 3컬럼 (latestReach / latestInsightsJson / insightsSyncedAt)
--
-- 설계 메모 (TDA):
--   - igMessageId 단독 unique: 우리 IG 계정 1개 + Meta message mid는 앱 스코프 전역 유일.
--     웹훅 재전송·message_echoes 중복도 같은 mid → 단독 unique가 멱등 키로 충분.
--     (Zalo 복합키 교훈은 다계정 상황 — 계정 2개+ 시 (igAccountId, igMessageId)로 이관)
--   - InstagramInsightSnapshot.igMediaId = NOT NULL DEFAULT '' (ACCOUNT 스코프 센티널):
--     nullable이면 unique가 NULL을 서로 다른 값으로 취급 → ACCOUNT 일 1회 멱등 붕괴 + Prisma upsert 불가.
--   - capturedOn = DATE (VN 기준 수집일) → (scope, igMediaId, capturedOn) unique로 일 1회 멱등.
--   - postId FK = ON DELETE SET NULL — 포스트 삭제 시 스냅샷(추이) 보존.
--
-- AppSetting 신규 키 (Phase 2 — 값 세팅은 INTEG/OPS 몫, 여기서는 문서화만):
--   IG_WEBHOOK_VERIFY_TOKEN — 웹훅 GET 검증(hub.challenge) 토큰. 평문 저장 가능(비밀성 낮음).
--   IG_APP_SECRET           — X-Hub-Signature-256 서명 검증용 앱 시크릿. ★AES-256-GCM 암호화 저장
--                             (lib/secret-crypto encryptSecret/decryptSecret, 키=ZALO_CREDS_KEY 재사용).
--   IG_REELS_PER_WEEK       — 주당 릴스 초안 수. 기본 0=끔(미설정=0 취급).
--
-- 신규 enum이므로 CREATE TYPE — idempotent 위해 DO 블록 duplicate_object 흡수.

DO $$ BEGIN
  CREATE TYPE "IgMsgDirection" AS ENUM ('IN', 'OUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "IgInsightScope" AS ENUM ('ACCOUNT', 'MEDIA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ① DM 인박스
CREATE TABLE IF NOT EXISTS "InstagramMessage" (
  "id" TEXT NOT NULL,
  "igThreadId" TEXT NOT NULL,
  "igSenderId" TEXT NOT NULL,
  "senderName" TEXT,
  "direction" "IgMsgDirection" NOT NULL,
  "text" TEXT,
  "attachments" JSONB,
  "igMessageId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "readByAdmin" BOOLEAN NOT NULL DEFAULT false,
  "autoReplied" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstagramMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InstagramMessage_igMessageId_key" ON "InstagramMessage"("igMessageId");
CREATE INDEX IF NOT EXISTS "InstagramMessage_igThreadId_receivedAt_idx" ON "InstagramMessage"("igThreadId", "receivedAt");
CREATE INDEX IF NOT EXISTS "InstagramMessage_readByAdmin_idx" ON "InstagramMessage"("readByAdmin");

-- ② 인사이트 스냅샷
CREATE TABLE IF NOT EXISTS "InstagramInsightSnapshot" (
  "id" TEXT NOT NULL,
  "scope" "IgInsightScope" NOT NULL,
  "igMediaId" TEXT NOT NULL DEFAULT '',
  "postId" TEXT,
  "capturedOn" DATE NOT NULL,
  "metricsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstagramInsightSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InstagramInsightSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "InstagramPost"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "InstagramInsightSnapshot_scope_igMediaId_capturedOn_key" ON "InstagramInsightSnapshot"("scope", "igMediaId", "capturedOn");
CREATE INDEX IF NOT EXISTS "InstagramInsightSnapshot_postId_capturedOn_idx" ON "InstagramInsightSnapshot"("postId", "capturedOn");
CREATE INDEX IF NOT EXISTS "InstagramInsightSnapshot_scope_capturedOn_idx" ON "InstagramInsightSnapshot"("scope", "capturedOn");

-- ③ InstagramPost 인사이트 캐시 (최신값 — 정본은 스냅샷)
ALTER TABLE "InstagramPost" ADD COLUMN IF NOT EXISTS "latestReach" INTEGER;
ALTER TABLE "InstagramPost" ADD COLUMN IF NOT EXISTS "latestInsightsJson" JSONB;
ALTER TABLE "InstagramPost" ADD COLUMN IF NOT EXISTS "insightsSyncedAt" TIMESTAMP(3);
