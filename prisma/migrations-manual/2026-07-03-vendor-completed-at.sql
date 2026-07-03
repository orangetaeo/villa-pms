-- 2026-07-03 VENDOR 서비스 이행 완료 보고 (vendor-gaps-p1 계약 C)
-- additive·멱등. 적용: npx prisma db execute --file prisma/migrations-manual/2026-07-03-vendor-completed-at.sql --schema prisma/schema.prisma
-- 롤백: ALTER TABLE "ServiceOrder" DROP COLUMN IF EXISTS "vendorCompletedAt";
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vendorCompletedAt" TIMESTAMP(3);
