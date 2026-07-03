-- T-partner-workflow-gaps: 파트너 취소·변경·홀드연장 요청 테이블 (additive — 기존 데이터 무접촉)
-- 적용: npx prisma db execute --file prisma/sql/2026-07-03-booking-change-request.sql --schema prisma/schema.prisma
CREATE TABLE IF NOT EXISTS "BookingChangeRequest" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "resolvedById" TEXT,
  "resolutionNote" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingChangeRequest_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "BookingChangeRequest"
    ADD CONSTRAINT "BookingChangeRequest_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BookingChangeRequest"
    ADD CONSTRAINT "BookingChangeRequest_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BookingChangeRequest"
    ADD CONSTRAINT "BookingChangeRequest_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "BookingChangeRequest_status_createdAt_idx"
  ON "BookingChangeRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "BookingChangeRequest_bookingId_idx"
  ON "BookingChangeRequest"("bookingId");
CREATE INDEX IF NOT EXISTS "BookingChangeRequest_partnerId_createdAt_idx"
  ON "BookingChangeRequest"("partnerId", "createdAt");
