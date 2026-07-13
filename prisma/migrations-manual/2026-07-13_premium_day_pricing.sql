-- 2026-07-13 프리미엄일(요일·공휴일) 2단 요금 (ADR-0042) — additive only
-- 적용: Railway Postgres에 수동 실행 후 `npx prisma generate`
-- 무중단: 신규 컬럼 전부 nullable(폴백=평일가) / premiumDays는 default 있어도
--         premium* 가격이 null이라 기존 빌라 견적 결과 불변.

-- 1) Villa.premiumDays — 프리미엄 요일 (getUTCDay 기준 0=일…6=토, 기본 금·토)
ALTER TABLE "Villa"
  ADD COLUMN IF NOT EXISTS "premiumDays" INTEGER[] NOT NULL DEFAULT '{5,6}';

-- 2) HolidayDate — 전역 공휴일 캘린더 (한국·베트남 공용, 빌라 무관, 전야 자동계산 없음)
CREATE TABLE IF NOT EXISTS "HolidayDate" (
  "id"        TEXT NOT NULL,
  "date"      DATE NOT NULL,
  "label"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HolidayDate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HolidayDate_date_key" ON "HolidayDate"("date");

-- 3) VillaRatePeriod 프리미엄 가격 컬럼 — 전부 nullable, null = 같은 행 평일 컬럼 폴백(컬럼 단위)
--    금액 타입: VND=BIGINT, KRW=INTEGER (부동소수점 금지)
ALTER TABLE "VillaRatePeriod"
  ADD COLUMN IF NOT EXISTS "premiumSupplierCostVnd"      BIGINT,
  ADD COLUMN IF NOT EXISTS "premiumSalePriceVnd"         BIGINT,
  ADD COLUMN IF NOT EXISTS "premiumSalePriceKrw"         INTEGER,
  ADD COLUMN IF NOT EXISTS "premiumConsumerSalePriceVnd" BIGINT,
  ADD COLUMN IF NOT EXISTS "premiumConsumerSalePriceKrw" INTEGER,
  ADD COLUMN IF NOT EXISTS "premiumSupplierSalePriceVnd" BIGINT;
