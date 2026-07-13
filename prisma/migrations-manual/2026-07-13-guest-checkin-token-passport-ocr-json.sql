-- ADR-0043: 게스트 여권 업로드 즉시 자동 OCR 잠정 명단 (guest-passport-auto-ocr-roster)
-- GuestCheckinToken.passportOcrJson (Json?) — 게스트 자동 OCR 잠정본(PassportOcrData[] 업로드순 누적).
--   운영자 확정본(CheckInRecord.passportOcrJson)이 항상 우선. additive only.
ALTER TABLE "GuestCheckinToken" ADD COLUMN IF NOT EXISTS "passportOcrJson" JSONB;
