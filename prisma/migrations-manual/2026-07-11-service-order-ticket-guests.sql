-- 2026-07-11 — ADR-0036: 티켓 이용자 선택 스냅샷 (additive)
-- 소비자가 티켓 신청 시 체크인 명단(여권 OCR 확정본)에서 고른 이용자 [{name, birthDate}]를
-- 주문에 스냅샷 저장해 티켓 벤더에 전달(차일드/어덜트/시니어 구분용).
-- ★이름·생년월일만 저장 — 여권번호·국적·성별·만료일 금지.
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "ticketGuests" JSONB;
