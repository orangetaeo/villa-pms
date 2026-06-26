-- 미니바 실재고 이동 원장 (ADR-0019 S1) — MinibarStockMovement + MinibarMovementType
-- 현재고는 캐시 컬럼이 아니라 이 원장의 ΣqtyDelta로 산출(VillaMinibarStock sparse 구조 회피).
-- additive only — prisma db push 금지(라이브 드리프트 드롭 회피, [[db-schema-drift-villa-source]]). 이 파일을 수동 실행.
--   실행: npx prisma db execute --file prisma/migrations-manual/2026-06-26-minibar-inventory.sql --schema prisma/schema.prisma

DO $$ BEGIN
  CREATE TYPE "MinibarMovementType" AS ENUM ('RESTOCK', 'CONSUME', 'ADJUST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "MinibarStockMovement" (
  "id"            TEXT NOT NULL,
  "villaId"       TEXT NOT NULL,
  "minibarItemId" TEXT NOT NULL,
  "type"          "MinibarMovementType" NOT NULL,
  "qtyDelta"      INTEGER NOT NULL,
  "unitCostVnd"   BIGINT,
  "bookingId"     TEXT,
  "note"          TEXT,
  "createdBy"     TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MinibarStockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MinibarStockMovement_villaId_minibarItemId_idx"
  ON "MinibarStockMovement" ("villaId", "minibarItemId");

CREATE INDEX IF NOT EXISTS "MinibarStockMovement_createdAt_idx"
  ON "MinibarStockMovement" ("createdAt");

-- FK: 빌라/품목 삭제 시 이동행도 함께 삭제(cascade). booking은 보존(SetNull).
ALTER TABLE "MinibarStockMovement"
  ADD CONSTRAINT "MinibarStockMovement_villaId_fkey"
  FOREIGN KEY ("villaId") REFERENCES "Villa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MinibarStockMovement"
  ADD CONSTRAINT "MinibarStockMovement_minibarItemId_fkey"
  FOREIGN KEY ("minibarItemId") REFERENCES "MinibarItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MinibarStockMovement"
  ADD CONSTRAINT "MinibarStockMovement_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
