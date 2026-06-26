-- ADR-0023 S5 — 원천 공급자 자가 회원가입 승인 게이트 (additive, db push 금지)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VendorApprovalStatus') THEN
    CREATE TYPE "VendorApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');
  END IF;
END$$;

-- 기존 행은 APPROVED(운영자가 만든 것). 자가가입만 PENDING_APPROVAL로 명시 생성.
ALTER TABLE "ServiceVendor" ADD COLUMN IF NOT EXISTS "approvalStatus" "VendorApprovalStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "ServiceVendor" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "ServiceVendor" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ServiceVendor_approvalStatus_idx" ON "ServiceVendor" ("approvalStatus");
