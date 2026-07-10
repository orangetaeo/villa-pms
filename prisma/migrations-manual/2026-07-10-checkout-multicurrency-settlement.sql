-- 체크아웃 게스트 수납 다통화 분할 (테오 요청 2026-07-10) — CheckOutRecord 통화별 실수납액 + 환율 스냅샷
-- additive only — prisma db push 금지. 수동 실행.
--   실행: npx prisma db execute --file prisma/migrations-manual/2026-07-10-checkout-multicurrency-settlement.sql --schema prisma/schema.prisma

ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settledVnd"   BIGINT;
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settledKrw"   INTEGER;
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settledUsd"   INTEGER;
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settlementFx" JSONB;
