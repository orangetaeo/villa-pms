-- ADR-0019 v2 — 게스트 여권사진·옵션 시각·카탈로그 자동번역 저장
-- additive only — prisma db push 금지. 수동 실행.
--   실행: npx prisma db execute --file prisma/migrations-manual/2026-06-26-addon-v2.sql --schema prisma/schema.prisma

-- #1 게스트 셀프 여권 사진
ALTER TABLE "GuestCheckinToken" ADD COLUMN IF NOT EXISTS "passportPhotoUrls" TEXT[] NOT NULL DEFAULT '{}';

-- #3 옵션 희망 시각(HH:MM 자유입력)
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "serviceTime" TEXT;

-- #6 카탈로그 자동번역 저장(이름·설명, {en,vi,zh,ru})
ALTER TABLE "ServiceCatalogItem" ADD COLUMN IF NOT EXISTS "nameI18n" JSONB;
ALTER TABLE "ServiceCatalogItem" ADD COLUMN IF NOT EXISTS "descI18n" JSONB;
