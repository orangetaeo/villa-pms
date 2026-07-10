-- 2026-07-10 티켓형 부가옵션 QR 발행 (ADR-0034) — additive만, 드롭 없음
-- ServiceOrder에 티켓 이미지 URL 목록 + 최초 발행 시각 추가 (CleaningTask.photoUrls 동형)
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "ticketUrls" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "ticketsIssuedAt" TIMESTAMP(3);
