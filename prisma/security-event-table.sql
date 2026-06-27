-- 보안 P0-1 SecurityEvent 감사 채널 — 라이브 Neon에 additive 적용 (CREATE IF NOT EXISTS, 비파괴).
-- 공유 DB 규칙: prisma db push 금지(드롭 위험), additive는 raw SQL ALTER/CREATE로.
CREATE TABLE IF NOT EXISTS "SecurityEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorPhone" TEXT,
  "ip" TEXT,
  "path" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SecurityEvent_type_createdAt_idx" ON "SecurityEvent" ("type", "createdAt");
CREATE INDEX IF NOT EXISTS "SecurityEvent_actorUserId_idx" ON "SecurityEvent" ("actorUserId");
CREATE INDEX IF NOT EXISTS "SecurityEvent_createdAt_idx" ON "SecurityEvent" ("createdAt");
