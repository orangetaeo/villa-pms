-- 2026-07-16 — ADR-0045: 홈페이지 다국어 웹 채팅 (WebChatSession + WebChatMessage) — additive만, 드롭 없음
-- villa-go.net 비로그인 방문자(국제 관광객·여행사)가 사이트에서 바로 운영자(테오)와 채팅.
-- ZaloMessage 재사용 기각(zaloUserId·threadType 강결합) → 신규 분리 테이블 2개. ★금액 컬럼 없음(마진 누수 표면 제거).
-- 규약(CLAUDE.md): 라이브 Railway DB에 additive raw SQL 직접 적용, prisma migrate/db push 금지. 멱등(IF NOT EXISTS).
-- 적용: npx prisma db execute --file prisma/migrations-manual/2026-07-16_webchat.sql --schema prisma/schema.prisma
-- ⚠ NotificationType enum 값 추가는 트랜잭션 제약으로 별도 파일 분리:
--    2026-07-16_webchat-notiftype.sql (ALTER TYPE ADD VALUE — 단독 실행)
-- 롤백: Postgres enum 값 제거 미지원(미사용 무해). 테이블은 DROP TABLE로 제거 가능(데이터 없음 전제).

-- 1) enum 타입 (멱등 — 이미 있으면 무시)
DO $$ BEGIN
  CREATE TYPE "WebChatSessionStatus" AS ENUM ('OPEN','CLOSED','BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WebChatDirection" AS ENUM ('INBOUND','OUTBOUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) WebChatSession — 방문자 세션(익명). ownerAdminId=수신 ADMIN(기본 테오). ★금액 컬럼 없음.
CREATE TABLE IF NOT EXISTS "WebChatSession" (
  "id"                   TEXT NOT NULL,
  "ownerAdminId"         TEXT NOT NULL,
  "visitorLocale"        TEXT NOT NULL,
  "status"               "WebChatSessionStatus" NOT NULL DEFAULT 'OPEN',
  "contactEmail"         TEXT,
  "contactZalo"          TEXT,
  "contactKakao"         TEXT,
  "sourcePage"           TEXT,
  "ipHash"               TEXT NOT NULL,
  "unreadForAdmin"       INTEGER NOT NULL DEFAULT 0,
  "lastMessageText"      TEXT,
  "lastMessageDirection" "WebChatDirection",
  "lastMessageAt"        TIMESTAMP(3),
  "expiresAt"            TIMESTAMP(3) NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebChatSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebChatSession_ownerAdminId_fkey" FOREIGN KEY ("ownerAdminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "WebChatSession_ownerAdminId_lastMessageAt_idx" ON "WebChatSession"("ownerAdminId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "WebChatSession_status_idx" ON "WebChatSession"("status");
CREATE INDEX IF NOT EXISTS "WebChatSession_ipHash_createdAt_idx" ON "WebChatSession"("ipHash", "createdAt");

-- 3) WebChatMessage — 방향별 원문 + 번역 캐시. ★금액 컬럼 없음.
CREATE TABLE IF NOT EXISTS "WebChatMessage" (
  "id"                TEXT NOT NULL,
  "sessionId"         TEXT NOT NULL,
  "direction"         "WebChatDirection" NOT NULL,
  "text"              TEXT NOT NULL,
  "sourceLocale"      TEXT NOT NULL,
  "translatedText"    TEXT,
  "translatedTo"      TEXT,
  "translationFailed" BOOLEAN NOT NULL DEFAULT false,
  "status"            TEXT NOT NULL DEFAULT 'SENT',
  "sentBy"            TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WebChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "WebChatMessage_sessionId_createdAt_idx" ON "WebChatMessage"("sessionId", "createdAt");
