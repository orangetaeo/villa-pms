-- 부가서비스 픽업/방문 이행 모델 (마사지·이발 등 APPOINTMENT)
-- additive·nullable — 기존 행/배포 무영향. ADD COLUMN IF NOT EXISTS로 멱등.
ALTER TABLE "ServiceCatalogItem"
  ADD COLUMN IF NOT EXISTS "pickupAvailable" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "pickupNote" TEXT;
