-- 부가서비스 카탈로그 + 게스트 요청 확장 (ADR-0019 S2)
-- additive only — prisma db push 금지(라이브 드리프트 회피). 수동 실행.
--   실행: npx prisma db execute --file prisma/migrations-manual/2026-06-26-service-catalog.sql --schema prisma/schema.prisma
-- ⚠ enum ADD VALUE는 각각 별도 트랜잭션 — 같은 배치의 뒤 DDL에서 새 값 사용 불가. 이 파일은 enum만 먼저 실행 후
--   나머지를 재실행해도 무방(IF NOT EXISTS 멱등). prisma db execute는 파일 전체를 한 번에 보내므로 enum 추가가
--   먼저 커밋되도록 본 파일을 2회 실행하거나, 아래처럼 새 enum 값을 직접 참조하지 않게 구성한다(여기선 미참조).

-- 1) ServiceType 신규 값 (각각 멱등)
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'MOTORBIKE_RENTAL';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'MASSAGE';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'BARBER';

-- 2) 주문 출처 enum
DO $$ BEGIN
  CREATE TYPE "ServiceRequestedVia" AS ENUM ('ADMIN', 'GUEST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3) 카탈로그 테이블
CREATE TABLE IF NOT EXISTS "ServiceCatalogItem" (
  "id"          TEXT NOT NULL,
  "type"        "ServiceType" NOT NULL,
  "nameKo"      TEXT NOT NULL,
  "nameVi"      TEXT,
  "nameEn"      TEXT,
  "descKo"      TEXT,
  "descVi"      TEXT,
  "unitLabelKo" TEXT,
  "priceKrw"    INTEGER,
  "priceVnd"    BIGINT,
  "costVnd"     BIGINT,
  "photoUrl"    TEXT,
  "options"     JSONB,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceCatalogItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ServiceCatalogItem_active_sortOrder_idx"
  ON "ServiceCatalogItem" ("active", "sortOrder");

-- 4) ServiceOrder 확장(전부 additive·nullable/default)
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "catalogItemId"   TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "quantity"        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "selectedOptions" JSONB;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "requestedVia"    "ServiceRequestedVia" NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "guestNote"       TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "priceVnd"        BIGINT;
