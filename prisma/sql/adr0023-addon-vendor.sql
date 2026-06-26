-- ADR-0023 부가서비스 원천 공급자 중계 — additive only (db push 금지, raw SQL ALTER)
-- 멱등: IF NOT EXISTS / DO 가드. 기존 데이터 무손상.

-- 1) enum ADD VALUE (PG12+: 트랜잭션 내 추가 가능, 같은 txn서 사용 안 함)
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'VENDOR';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'FRUIT';
ALTER TYPE "ServiceRequestedVia" ADD VALUE IF NOT EXISTS 'PARTNER';

-- 2) 신규 enum ServiceVendorStatus (CREATE TYPE는 IF NOT EXISTS 미지원 → DO 가드)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ServiceVendorStatus') THEN
    CREATE TYPE "ServiceVendorStatus" AS ENUM ('PENDING_VENDOR', 'VENDOR_ACCEPTED', 'VENDOR_REJECTED');
  END IF;
END$$;

-- 3) 신규 테이블 ServiceVendor
CREATE TABLE IF NOT EXISTS "ServiceVendor" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT,
  "name"       TEXT NOT NULL,
  "nameKo"     TEXT,
  "phone"      TEXT,
  "zaloUserId" TEXT,
  "bankInfo"   JSONB,
  "note"       TEXT,
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceVendor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceVendor_userId_key" ON "ServiceVendor" ("userId");
CREATE INDEX IF NOT EXISTS "ServiceVendor_active_idx" ON "ServiceVendor" ("active");

-- 4) ServiceCatalogItem 확장
ALTER TABLE "ServiceCatalogItem" ADD COLUMN IF NOT EXISTS "vendorId" TEXT;
ALTER TABLE "ServiceCatalogItem" ADD COLUMN IF NOT EXISTS "audiences" JSONB NOT NULL DEFAULT '["ADMIN"]';

-- 5) ServiceOrder 확장 (컬럼만, 로직은 S2)
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vendorId" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vendorStatus" "ServiceVendorStatus";
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "poSentAt" TIMESTAMP(3);
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vendorRespondedAt" TIMESTAMP(3);
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vendorRejectReason" TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vendorSettledAt" TIMESTAMP(3);
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vendorSettleMethod" "GuestSettlementMethod";
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vendorSettleNote" TEXT;

-- 6) FK 제약 (DO 가드 — IF NOT EXISTS 미지원)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceVendor_userId_fkey') THEN
    ALTER TABLE "ServiceVendor" ADD CONSTRAINT "ServiceVendor_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceCatalogItem_vendorId_fkey') THEN
    ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "ServiceVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceOrder_vendorId_fkey') THEN
    ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "ServiceVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- 7) ServiceOrder 발주 조회 인덱스
CREATE INDEX IF NOT EXISTS "ServiceOrder_vendorId_vendorStatus_idx" ON "ServiceOrder" ("vendorId", "vendorStatus");
