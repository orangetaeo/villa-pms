-- 2026-07-10 custom 비품 라벨 vi→ko 저장형 번역 컬럼 (T-amenity-quantity-custom)
-- 목적: itemKey="custom" 직접입력 항목(공급자 vi 입력)의 한국어 번역을 저장해 관리자·게스트 ko 표면에 병기.
--   저장 파이프라인이 best-effort로 채운다(Gemini). null=미번역 → ko 표면은 customLabelKo ?? customLabel 폴백.
-- 주의: additive·멱등. db push 금지(라이브 드리프트). 적용은 db execute로만.
-- 적용: npx prisma db execute --file prisma/migrations-manual/2026-07-10-amenity-custom-label-ko.sql --schema prisma/schema.prisma
-- 롤백: ALTER TABLE "VillaAmenity" DROP COLUMN IF EXISTS "customLabelKo";
-- ✅ 2026-07-10 라이브(Railway) 적용 완료 — information_schema로 컬럼 존재 검증됨.
ALTER TABLE "VillaAmenity" ADD COLUMN IF NOT EXISTS "customLabelKo" TEXT;
