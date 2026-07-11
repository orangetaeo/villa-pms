-- 2026-07-11 부가서비스 이용자 이름 (테오 지시) — additive만
-- 게스트 입력 또는 예약 대표자(guestName) 폴백 스냅샷. 벤더 발주 노출용(이름만).
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
