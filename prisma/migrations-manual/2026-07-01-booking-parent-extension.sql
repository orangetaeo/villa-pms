-- ADR-0030 T-E: 분할 숙박 — Booking.parentBookingId (연결된 추가 예약) additive 마이그레이션.
--   실행: npx prisma db execute --file prisma/migrations-manual/2026-07-01-booking-parent-extension.sql --schema prisma/schema.prisma
-- ★ enum 변경 없음. nullable 컬럼 1개 + self-FK + 인덱스만 → 기존 코드/세션 무영향. 멱등(IF NOT EXISTS).
-- 롤백: ALTER TABLE "Booking" DROP CONSTRAINT "Booking_parentBookingId_fkey"; ALTER TABLE "Booking" DROP COLUMN "parentBookingId";

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "parentBookingId" text;

CREATE INDEX IF NOT EXISTS "Booking_parentBookingId_idx" ON "Booking" ("parentBookingId");

DO $$ BEGIN
  ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_parentBookingId_fkey"
    FOREIGN KEY ("parentBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
