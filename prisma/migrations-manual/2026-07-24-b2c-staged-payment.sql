-- 2026-07-24 · T-b2c-staged-payment P1 (ADR-0048) — B2C 계약금/잔금 VND 앵커 다통화 결제
--
-- additive only. 파괴 0. 적용 후 `npx prisma generate` 필수.
-- 구성:
--   1) PaymentPurpose enum에 B2C_DEPOSIT·B2C_BALANCE 추가 (트랜잭션 밖 — Postgres ADD VALUE 제약)
--   2) B2cScheduleStatus enum + B2cPaymentSchedule 테이블 (예약당 1건, VND 앵커 스케줄)
--   3) AppSetting 시드: B2C_DEPOSIT_RATE_PCT=50, B2C_BALANCE_LEAD_DAYS=14 (기존 있으면 보존)
--   4) [데이터] 기존 예약 Booking.totalSaleVnd 앵커 백필 — ★별도 검토(맨 아래, 주석 해제 후 실행)

-- 1) enum 값 추가 (ALTER TYPE ADD VALUE는 트랜잭션 블록 밖에서 — 같은 txn 내 사용 불가 제약 회피)
ALTER TYPE "PaymentPurpose" ADD VALUE IF NOT EXISTS 'B2C_DEPOSIT';
ALTER TYPE "PaymentPurpose" ADD VALUE IF NOT EXISTS 'B2C_BALANCE';

BEGIN;

-- 2) 스케줄 상태 enum (멱등)
DO $$ BEGIN
  CREATE TYPE "B2cScheduleStatus" AS ENUM ('PENDING', 'DEPOSIT_PAID', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) 스케줄 테이블 (예약당 1건 = bookingId UNIQUE)
CREATE TABLE IF NOT EXISTS "B2cPaymentSchedule" (
  "id"             TEXT NOT NULL,
  "bookingId"      TEXT NOT NULL,
  "totalVnd"       BIGINT NOT NULL,
  "depositRatePct" INTEGER NOT NULL,
  "depositDueVnd"  BIGINT NOT NULL,
  "balanceDueVnd"  BIGINT NOT NULL,
  "depositDueDate" DATE NOT NULL,
  "balanceDueDate" DATE,
  "fullPrepay"     BOOLEAN NOT NULL DEFAULT false,
  "status"         "B2cScheduleStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "B2cPaymentSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "B2cPaymentSchedule_bookingId_key"
  ON "B2cPaymentSchedule"("bookingId");
CREATE INDEX IF NOT EXISTS "B2cPaymentSchedule_status_balanceDueDate_idx"
  ON "B2cPaymentSchedule"("status", "balanceDueDate");

-- FK (있으면 스킵). onDelete Cascade = 예약 삭제 시 스케줄 동반 삭제
DO $$ BEGIN
  ALTER TABLE "B2cPaymentSchedule"
    ADD CONSTRAINT "B2cPaymentSchedule_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3) 정책 AppSetting 시드 (기존 값 있으면 보존 — 운영자가 이미 조정했을 수 있음)
INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES
  ('B2C_DEPOSIT_RATE_PCT', '50', CURRENT_TIMESTAMP),
  ('B2C_BALANCE_LEAD_DAYS', '14', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

COMMIT;

-- 4) ★[데이터 백필 — 별도 실행] 기존 KRW 예약의 VND 앵커 채우기.
--    totalSaleVnd가 비어있고 KRW 총액·환율 스냅샷이 있는 예약만 안전하게 환산 채움(파괴 0, null만 채움).
--    실행 전 대상 건수 확인:
--      SELECT count(*) FROM "Booking"
--       WHERE "totalSaleVnd" IS NULL AND "totalSaleKrw" IS NOT NULL AND "fxVndPerKrw" IS NOT NULL;
--    확인 후 아래 주석 해제 실행:
-- UPDATE "Booking"
--    SET "totalSaleVnd" = ROUND("totalSaleKrw"::numeric * "fxVndPerKrw")::bigint
--  WHERE "totalSaleVnd" IS NULL
--    AND "totalSaleKrw" IS NOT NULL
--    AND "fxVndPerKrw" IS NOT NULL;
--    ※ totalSaleVnd는 NOT NULL로 승격하지 않는다(백필 100% 검증 후 별도 하드닝 단계에서). ADR-0048 §5.
