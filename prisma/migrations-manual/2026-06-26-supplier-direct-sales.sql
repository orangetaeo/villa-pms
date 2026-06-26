-- F10 공급자 직접 판매 채널 (ADR-0021) — Booking.seller + supplierSalePriceVnd + NotificationType 값
-- additive only — prisma db push 금지(라이브 드리프트 드롭 회피, [[db-schema-drift-villa-source]]). 이 파일을 수동 실행.
--   실행: npx prisma db execute --file prisma/migrations-manual/2026-06-26-supplier-direct-sales.sql --schema prisma/schema.prisma
-- 병렬 주의: PARTNER-1(ADR-0022)도 Booking을 ALTER(partnerId) 예정 — 컬럼명 비충돌(seller/supplierSalePriceVnd ↔ partnerId), 순차 적용 안전.

-- 1) 판매 주체 enum (OPERATOR=우리 재판매 / SUPPLIER=공급자 직접판매)
DO $$ BEGIN
  CREATE TYPE "BookingSeller" AS ENUM ('OPERATOR', 'SUPPLIER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2) Booking.seller — 기존 전 예약은 DEFAULT 'OPERATOR'로 안전 백필
ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "seller" "BookingSeller" NOT NULL DEFAULT 'OPERATOR';

-- 3) Booking.supplierSalePriceVnd — 공급자 직접판매 수금액(공급자 기록용, 우리 회계 무관)
ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "supplierSalePriceVnd" BIGINT;

-- 4) NotificationType에 직접예약 생성 알림 값 추가 (운영자 선점 기회 통지)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUPPLIER_DIRECT_BOOKING';
