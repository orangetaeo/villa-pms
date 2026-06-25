-- 정산 2차 P2-3 복식부기 LEDGER (ADR-0018)
-- 모든 자금 이동을 통화별 균형 분개(차변 +, 대변 −)로 적재. 무결성 = 통화별 sum(amount)=0.
-- additive only — prisma db push 금지(라이브 드리프트 드롭 회피, [[db-schema-drift-villa-source]]). 이 파일을 수동 실행.

-- 1) enum 2종 (이미 있으면 무시)
DO $$ BEGIN
  CREATE TYPE "LedgerAccount" AS ENUM ('CASH_KRW','CASH_VND','SUPPLIER_PAYABLE','REVENUE','COGS','FX_GAIN_LOSS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LedgerEntryType" AS ENUM ('COLLECTION','COST_ACCRUAL','PAYOUT','FX_ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) LedgerTransaction
CREATE TABLE IF NOT EXISTS "LedgerTransaction" (
  "id"           TEXT NOT NULL,
  "type"         "LedgerEntryType" NOT NULL,
  "occurredAt"   TIMESTAMP(3) NOT NULL,
  "paymentId"    TEXT,
  "settlementId" TEXT,
  "memo"         TEXT,
  "createdBy"    TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- COLLECTION 1:1 멱등 (paymentId 유일)
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerTransaction_paymentId_key"
  ON "LedgerTransaction" ("paymentId");

CREATE INDEX IF NOT EXISTS "LedgerTransaction_settlementId_type_idx"
  ON "LedgerTransaction" ("settlementId", "type");

-- 3) LedgerLine
CREATE TABLE IF NOT EXISTS "LedgerLine" (
  "id"            TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "account"       "LedgerAccount" NOT NULL,
  "currency"      "Currency" NOT NULL,
  "amount"        BIGINT NOT NULL,
  CONSTRAINT "LedgerLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LedgerLine_transactionId_idx"
  ON "LedgerLine" ("transactionId");

CREATE INDEX IF NOT EXISTS "LedgerLine_account_currency_idx"
  ON "LedgerLine" ("account", "currency");

-- FK: 거래 삭제 시 분개선도 함께 삭제(cascade) — FX 재조정 시 기존 분개 삭제·재생성에 필요
ALTER TABLE "LedgerLine"
  ADD CONSTRAINT "LedgerLine_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
