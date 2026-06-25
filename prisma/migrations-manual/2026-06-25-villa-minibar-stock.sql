-- #2c 빌라별 미니바 비치수량 오버라이드 (VillaMinibarStock)
-- 가격(unitPriceVnd)은 회사표준(MinibarItem) 그대로, 수량(qty)만 빌라별. 오버라이드 없으면 MinibarItem.stockQty 사용.
-- additive only — prisma db push 금지(Villa.source 등 라이브 드리프트 드롭 회피, [[db-schema-drift-villa-source]]). 이 파일을 수동 실행.

CREATE TABLE IF NOT EXISTS "VillaMinibarStock" (
  "id"            TEXT NOT NULL,
  "villaId"       TEXT NOT NULL,
  "minibarItemId" TEXT NOT NULL,
  "qty"           INTEGER NOT NULL,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VillaMinibarStock_pkey" PRIMARY KEY ("id")
);

-- (빌라 × 품목) 1행만 — upsert 기준
CREATE UNIQUE INDEX IF NOT EXISTS "VillaMinibarStock_villaId_minibarItemId_key"
  ON "VillaMinibarStock" ("villaId", "minibarItemId");

CREATE INDEX IF NOT EXISTS "VillaMinibarStock_villaId_idx"
  ON "VillaMinibarStock" ("villaId");

-- FK: 빌라/품목 삭제 시 오버라이드도 함께 삭제(cascade)
ALTER TABLE "VillaMinibarStock"
  ADD CONSTRAINT "VillaMinibarStock_villaId_fkey"
  FOREIGN KEY ("villaId") REFERENCES "Villa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VillaMinibarStock"
  ADD CONSTRAINT "VillaMinibarStock_minibarItemId_fkey"
  FOREIGN KEY ("minibarItemId") REFERENCES "MinibarItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
