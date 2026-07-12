-- 2026-07-12 — ADR-0038: 업체 담당 지역(다중) 커버리지 (additive)
-- 업체(ServiceVendor) 등록 시 담당 지역을 다중 선택하면, 그 지역(=Villa.complex 단지명) 빌라의
-- 마사지·이발 주문이 자동으로 그 업체로 발주된다(테오 지시). 해석 우선순위:
--   ① 빌라별 수동 지정(VillaServiceVendor) → ② 지역 매칭 활성·승인 업체가 정확히 1곳 → ③ 카탈로그 기본 폴백.
-- region은 자유 문자열(Villa.complex와 대칭 — FK 아님). API는 REGIONAL_VENDOR_TYPES(MASSAGE·BARBER)만 허용.
CREATE TABLE IF NOT EXISTS "ServiceVendorRegion" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "serviceType" "ServiceType" NOT NULL,
  "region" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceVendorRegion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceVendorRegion_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "ServiceVendor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceVendorRegion_vendorId_serviceType_region_key" ON "ServiceVendorRegion"("vendorId", "serviceType", "region");
CREATE INDEX IF NOT EXISTS "ServiceVendorRegion_serviceType_region_idx" ON "ServiceVendorRegion"("serviceType", "region");
