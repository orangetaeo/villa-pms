-- 2026-07-12 — ADR-0037: 빌라별 지역 지정 업체 (additive)
-- 마사지·이발처럼 지역 분포 업체는 발주 빌라에서 가까운 샵으로 자동 지정해야 함(테오 지시).
-- 주문 생성 시 REGIONAL_VENDOR_TYPES에 한해 이 매핑이 카탈로그 기본 벤더를 오버라이드. 빌라·타입당 1업체.
CREATE TABLE IF NOT EXISTS "VillaServiceVendor" (
  "id" TEXT NOT NULL,
  "villaId" TEXT NOT NULL,
  "serviceType" "ServiceType" NOT NULL,
  "vendorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VillaServiceVendor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VillaServiceVendor_villaId_fkey" FOREIGN KEY ("villaId") REFERENCES "Villa"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VillaServiceVendor_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ServiceVendor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "VillaServiceVendor_villaId_serviceType_key" ON "VillaServiceVendor"("villaId", "serviceType");
CREATE INDEX IF NOT EXISTS "VillaServiceVendor_vendorId_idx" ON "VillaServiceVendor"("vendorId");
