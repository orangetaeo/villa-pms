-- ADR-0024 — 파트너 청구서 수납 → LEDGER COLLECTION 연결
-- additive·무손상: Payment.bookingId NOT NULL 제약만 완화(청구서 수납은 bookingId 없이 Payment 생성).
-- db push 금지 — 라이브 DB에 raw SQL로 적용 후 prisma generate.
ALTER TABLE "Payment" ALTER COLUMN "bookingId" DROP NOT NULL;
