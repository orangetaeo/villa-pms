-- 게스트 셀프 체크인 토큰 + 동의서 버전 (ADR-0019 S3)
-- additive only — prisma db push 금지. 수동 실행.
--   실행: npx prisma db execute --file prisma/migrations-manual/2026-06-26-guest-checkin-token.sql --schema prisma/schema.prisma

ALTER TABLE "CheckInRecord" ADD COLUMN IF NOT EXISTS "agreementVersion" TEXT;

CREATE TABLE IF NOT EXISTS "GuestCheckinToken" (
  "id"          TEXT NOT NULL,
  "bookingId"   TEXT NOT NULL,
  "token"       TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "revokedAt"   TIMESTAMP(3),
  "firstUsedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestCheckinToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GuestCheckinToken_bookingId_key" ON "GuestCheckinToken" ("bookingId");
CREATE UNIQUE INDEX IF NOT EXISTS "GuestCheckinToken_token_key" ON "GuestCheckinToken" ("token");

DO $$ BEGIN
  ALTER TABLE "GuestCheckinToken"
    ADD CONSTRAINT "GuestCheckinToken_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 게스트 셀프 서명 보관(토큰에) — CheckInRecord 충돌 방지
ALTER TABLE "GuestCheckinToken" ADD COLUMN IF NOT EXISTS "agreementSignedAt" TIMESTAMP(3);
ALTER TABLE "GuestCheckinToken" ADD COLUMN IF NOT EXISTS "signatureUrl"      TEXT;
ALTER TABLE "GuestCheckinToken" ADD COLUMN IF NOT EXISTS "agreementVersion"  TEXT;
