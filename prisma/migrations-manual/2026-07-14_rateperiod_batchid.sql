-- rate-calendar-ux: VillaRatePeriod.batchId — 일괄 작업(일괄 조정·연도 복사·선택 적용) 그룹 키
-- additive·nullable — 무중단. 그룹 단위 취소 및 레이어 목록 묶음 표시용. 수동 생성 행은 NULL.
ALTER TABLE "VillaRatePeriod" ADD COLUMN IF NOT EXISTS "batchId" TEXT;
CREATE INDEX IF NOT EXISTS "VillaRatePeriod_villaId_batchId_idx" ON "VillaRatePeriod"("villaId", "batchId");
