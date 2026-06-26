-- 여행사·랜드사(B2B) 결제조건·미수(여신) 관리 (ADR-0022, PARTNER-1)
-- B2B 객실료 매출채권(AR) + 여신관리. 게스트 현장청구(보증금·미니바, ADR-0019)와 분리.
-- additive only — prisma db push 금지(라이브 드리프트 드롭 회피, [[db-schema-drift-villa-source]]). 이 파일을 수동 실행.
-- 배포 순서: ①이 SQL 적용 ②PR 머지·배포. 실행 전 prod 백업 권장.

-- 1) enum 6종 (이미 있으면 무시)
DO $$ BEGIN
  CREATE TYPE "PartnerType" AS ENUM ('TRAVEL_AGENCY','LAND_AGENCY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CreditTier" AS ENUM ('A','B','C');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE','SUSPENDED','BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReceivableStatus" AS ENUM ('PENDING','PARTIAL','PAID','OVERDUE','WRITTEN_OFF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PartnerInvoiceStatus" AS ENUM ('DRAFT','ISSUED','PARTIAL','PAID','OVERDUE','VOID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentPurpose" AS ENUM ('GUEST','DEPOSIT','BALANCE','INVOICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Partner
CREATE TABLE IF NOT EXISTS "Partner" (
  "id"              TEXT NOT NULL,
  "type"            "PartnerType" NOT NULL,
  "name"            TEXT NOT NULL,
  "nameVi"          TEXT,
  "contactPhone"    TEXT,
  "contactZaloUid"  TEXT,
  "contactEmail"    TEXT,
  "creditTier"      "CreditTier" NOT NULL DEFAULT 'A',
  "creditLimitVnd"  BIGINT NOT NULL DEFAULT 0,
  "depositRatePct"  INTEGER NOT NULL DEFAULT 30,
  "paymentTermDays" INTEGER NOT NULL DEFAULT 0,
  "billingCycle"    TEXT,
  "status"          "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
  "contractUrl"     TEXT,
  "memo"            TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Partner_type_status_idx" ON "Partner" ("type", "status");

-- 3) PartnerInvoice (PartnerReceivable.invoiceId FK 대상이므로 먼저 생성)
CREATE TABLE IF NOT EXISTS "PartnerInvoice" (
  "id"           TEXT NOT NULL,
  "partnerId"    TEXT NOT NULL,
  "periodStart"  DATE NOT NULL,
  "periodEnd"    DATE NOT NULL,
  "dueDate"      DATE NOT NULL,
  "totalVnd"     BIGINT NOT NULL,
  "paidVnd"      BIGINT NOT NULL DEFAULT 0,
  "status"       "PartnerInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "statementUrl" TEXT,
  "issuedAt"     TIMESTAMP(3),
  "paidAt"       TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PartnerInvoice_partnerId_periodStart_periodEnd_key"
  ON "PartnerInvoice" ("partnerId", "periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "PartnerInvoice_partnerId_status_idx"
  ON "PartnerInvoice" ("partnerId", "status");

-- 4) PartnerReceivable
CREATE TABLE IF NOT EXISTS "PartnerReceivable" (
  "id"             TEXT NOT NULL,
  "partnerId"      TEXT NOT NULL,
  "bookingId"      TEXT NOT NULL,
  "totalVnd"       BIGINT NOT NULL,
  "depositDueVnd"  BIGINT NOT NULL,
  "depositPaidVnd" BIGINT NOT NULL DEFAULT 0,
  "balancePaidVnd" BIGINT NOT NULL DEFAULT 0,
  "dueDate"        DATE NOT NULL,
  "status"         "ReceivableStatus" NOT NULL DEFAULT 'PENDING',
  "invoiceId"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerReceivable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PartnerReceivable_bookingId_key"
  ON "PartnerReceivable" ("bookingId");
CREATE INDEX IF NOT EXISTS "PartnerReceivable_partnerId_status_idx"
  ON "PartnerReceivable" ("partnerId", "status");
CREATE INDEX IF NOT EXISTS "PartnerReceivable_dueDate_status_idx"
  ON "PartnerReceivable" ("dueDate", "status");

-- 5) 기존 모델 확장 — Booking.partnerId
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "partnerId" TEXT;
CREATE INDEX IF NOT EXISTS "Booking_partnerId_idx" ON "Booking" ("partnerId");

-- 6) 기존 모델 확장 — Payment (purpose + 파트너 귀속 FK 스칼라)
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "purpose" "PaymentPurpose" NOT NULL DEFAULT 'GUEST';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "partnerId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "receivableId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;
CREATE INDEX IF NOT EXISTS "Payment_partnerId_idx" ON "Payment" ("partnerId");
CREATE INDEX IF NOT EXISTS "Payment_receivableId_idx" ON "Payment" ("receivableId");

-- 7) FK 제약 (DO 블록으로 중복 무시 — ADD CONSTRAINT IF NOT EXISTS 미지원 대비)
DO $$ BEGIN
  ALTER TABLE "Booking" ADD CONSTRAINT "Booking_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PartnerReceivable" ADD CONSTRAINT "PartnerReceivable_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PartnerReceivable" ADD CONSTRAINT "PartnerReceivable_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PartnerReceivable" ADD CONSTRAINT "PartnerReceivable_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "PartnerInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PartnerInvoice" ADD CONSTRAINT "PartnerInvoice_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
