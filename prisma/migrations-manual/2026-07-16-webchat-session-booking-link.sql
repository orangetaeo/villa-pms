-- T-webchat-guest-link-share: 웹챗 세션↔예약 연결 (additive)
-- 적용: 2026-07-16, prisma db execute (Railway 라이브 DB)
-- WebChatSession에 운영자 식별용 예약 연결 3컬럼 + 인덱스 + FK(SET NULL)

ALTER TABLE "WebChatSession" ADD COLUMN IF NOT EXISTS "bookingId" TEXT;
ALTER TABLE "WebChatSession" ADD COLUMN IF NOT EXISTS "bookingLinkedAt" TIMESTAMP(3);
ALTER TABLE "WebChatSession" ADD COLUMN IF NOT EXISTS "bookingLinkedBy" TEXT;

CREATE INDEX IF NOT EXISTS "WebChatSession_bookingId_idx" ON "WebChatSession"("bookingId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WebChatSession_bookingId_fkey'
  ) THEN
    ALTER TABLE "WebChatSession"
      ADD CONSTRAINT "WebChatSession_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
