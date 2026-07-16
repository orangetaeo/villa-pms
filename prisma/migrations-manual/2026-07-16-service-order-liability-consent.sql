-- 부가서비스 신청 시 책임 제한 고지 동의 스냅샷 (docs/contracts/service-order-liability-consent.md)
-- 소비자 신청 경로(/g 게스트, /p 파트너)에서 서버가 산출해 저장:
--   { agreedAt: ISO, version: string, locale, source: "guest" | "partner" }
-- null = 동의 제도 이전 주문 또는 admin 대리 생성(동의 미적용). 백필 금지.
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "liabilityConsentJson" JSONB;
