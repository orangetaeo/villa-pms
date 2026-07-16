-- 2026-07-16 — T-business-contract-esign: 사업 계약서 전자서명 정본 모델
-- 규약(CLAUDE.md): 라이브 Railway DB에 additive raw SQL 직접 적용, prisma migrate/db push 금지.
--   enum 생성은 IF NOT EXISTS 불가 → DO $$ … EXCEPTION WHEN duplicate_object 로 멱등 처리.
-- 적용: npx prisma db execute --file prisma/migrations-manual/2026-07-16-business-contract.sql --schema prisma/schema.prisma
-- 롤백: 미사용 테이블·타입은 무해. 필요 시 DROP TABLE "BusinessContract"; DROP TYPE ...;
--
-- ★ termsJson(JSONB)에는 별표(신원·취소수수료율·정산주기 등)만 — 원가·마진·판매가(KRW) 컬럼 없음.
--   서명 봉인: contentHash(서명 시점 렌더 전문 SHA-256)·signatureUrl(비공개 sig-)·signedAt.

DO $$ BEGIN
  CREATE TYPE "BusinessContractType" AS ENUM ('VILLA_SUPPLY', 'SERVICE_VENDOR', 'PARTNER_AGENCY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BusinessContractStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'VOID');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "BusinessContract" (
  "id"                  TEXT PRIMARY KEY,
  "type"                "BusinessContractType" NOT NULL,
  "counterpartId"       TEXT NOT NULL,
  "status"              "BusinessContractStatus" NOT NULL DEFAULT 'DRAFT',
  "standardVersion"     TEXT NOT NULL,
  "termsJson"           JSONB NOT NULL,
  "locale"              TEXT NOT NULL DEFAULT 'vi',
  "counterpartIdNumber" TEXT,
  "counterpartSignName" TEXT,
  "signatureUrl"        TEXT,
  "signedAt"            TIMESTAMP(3),
  "contentHash"         TEXT,
  "sentAt"              TIMESTAMP(3),
  "createdById"         TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BusinessContract_counterpartId_type_idx"
  ON "BusinessContract" ("counterpartId", "type");

-- counterpartAddress: 상대방이 서명 시 본인 입력(User 모델에 주소 없음). 정본 {{counterpartAddress}} 렌더용.
-- 미서명 시 렌더 "____". additive nullable.
ALTER TABLE "BusinessContract" ADD COLUMN IF NOT EXISTS "counterpartAddress" TEXT;
