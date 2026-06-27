-- perf(2026-06-27): Booking 자주 쓰는 필터/정렬 인덱스 (additive, prisma 명명규칙 일치).
-- 안전: IF NOT EXISTS — 재실행/이미 존재해도 무해. 드롭 없음.
CREATE INDEX IF NOT EXISTS "Booking_partnerId_createdAt_idx" ON "Booking" ("partnerId", "createdAt");
CREATE INDEX IF NOT EXISTS "Booking_status_checkIn_idx" ON "Booking" ("status", "checkIn");
CREATE INDEX IF NOT EXISTS "Booking_status_checkOut_idx" ON "Booking" ("status", "checkOut");
