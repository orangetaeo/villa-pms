-- 체크아웃 게스트 통합정산 (ADR-0019 S4) — CheckOutRecord 정산 필드 + GuestSettlementMethod
-- additive only — prisma db push 금지. 수동 실행.
--   실행: npx prisma db execute --file prisma/migrations-manual/2026-06-26-checkout-guest-settlement.sql --schema prisma/schema.prisma

DO $$ BEGIN
  CREATE TYPE "GuestSettlementMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "guestChargeVnd"   BIGINT;
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "guestChargeKrw"   INTEGER;
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settlementMethod" "GuestSettlementMethod";
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settledAt"        TIMESTAMP(3);
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settlementNote"   TEXT;
