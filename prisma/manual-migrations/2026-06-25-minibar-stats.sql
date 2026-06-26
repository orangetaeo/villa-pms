-- 미니바 판매 통계 (T-admin-minibar-stats) — additive only, 멱등(IF NOT EXISTS).
-- db push 금지(드롭 위험, memory: db-schema-drift) → prisma db execute로 라이브 DB에 직접 적용.
-- MinibarItem.costVnd: 매입 원가(추후 원가 입력 UI에서 채움, 현재 nullable).
-- CheckOutRecord.minibarChargeVnd: 미니바 판매 총액 분리 집계 캐시.
-- CheckoutMinibarLine: 체크아웃 미니바 판매 라인(품목 스냅샷) — 통계 단일 소스.

ALTER TABLE "MinibarItem" ADD COLUMN IF NOT EXISTS "costVnd" BIGINT;
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "minibarChargeVnd" BIGINT;

CREATE TABLE IF NOT EXISTS "CheckoutMinibarLine" (
  "id" TEXT NOT NULL,
  "checkOutRecordId" TEXT NOT NULL,
  "minibarItemId" TEXT,
  "nameKo" TEXT NOT NULL,
  "stockedQty" INTEGER NOT NULL DEFAULT 0,
  "consumedQty" INTEGER NOT NULL,
  "unitPriceVnd" BIGINT NOT NULL,
  "costVnd" BIGINT,
  "lineVnd" BIGINT NOT NULL,
  "lineCostVnd" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckoutMinibarLine_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CheckoutMinibarLine_checkOutRecordId_fkey') THEN
    ALTER TABLE "CheckoutMinibarLine"
      ADD CONSTRAINT "CheckoutMinibarLine_checkOutRecordId_fkey"
      FOREIGN KEY ("checkOutRecordId") REFERENCES "CheckOutRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CheckoutMinibarLine_minibarItemId_fkey') THEN
    ALTER TABLE "CheckoutMinibarLine"
      ADD CONSTRAINT "CheckoutMinibarLine_minibarItemId_fkey"
      FOREIGN KEY ("minibarItemId") REFERENCES "MinibarItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CheckoutMinibarLine_checkOutRecordId_idx" ON "CheckoutMinibarLine"("checkOutRecordId");
CREATE INDEX IF NOT EXISTS "CheckoutMinibarLine_minibarItemId_idx" ON "CheckoutMinibarLine"("minibarItemId");
