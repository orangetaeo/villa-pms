-- 2026-07-13 — 체크아웃 수납 결제수단 혼합(분할) 지원 (additive, 계약서 T-checkout-mixed-method-settlement)
-- 실수납이 "현금 500만₫ + 계좌이체 20만₩"처럼 수단이 섞여 들어올 수 있음(테오 지적).
-- 수납 라인(수단×통화×금액)을 원장으로 저장하고, CheckOutRecord.settledVnd/Krw/Usd는 Σ라인 비정규화 캐시로 유지.
-- settlementMethod는 라인 수단 1종이면 그 값, 2종 이상이면 MIXED(서버 파생 전용).

ALTER TYPE "GuestSettlementMethod" ADD VALUE IF NOT EXISTS 'MIXED';

CREATE TABLE IF NOT EXISTS "CheckoutSettlementLine" (
  "id" TEXT NOT NULL,
  "checkOutRecordId" TEXT NOT NULL,
  "method" "GuestSettlementMethod" NOT NULL,
  "currency" "Currency" NOT NULL,
  "amount" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckoutSettlementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CheckoutSettlementLine_checkOutRecordId_fkey" FOREIGN KEY ("checkOutRecordId") REFERENCES "CheckOutRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CheckoutSettlementLine_checkOutRecordId_idx" ON "CheckoutSettlementLine"("checkOutRecordId");
