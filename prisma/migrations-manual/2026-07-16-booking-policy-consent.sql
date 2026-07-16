-- 2026-07-16 — T-proposal-policy-consent: 가예약(제안 링크) 취소·환불 규정 전자 동의 기록
-- 직판(B2C, /p) 가예약 시점에 취소·환불 규정 동의를 서버 산출 스냅샷으로 보존(분쟁 방어).
-- 규약(CLAUDE.md): 라이브 Railway DB에 additive raw SQL 직접 적용, prisma migrate/db push 금지. 멱등(IF NOT EXISTS).
-- 적용: npx prisma db execute --file prisma/migrations-manual/2026-07-16-booking-policy-consent.sql --schema prisma/schema.prisma
-- 롤백: 미사용 컬럼은 무해. 필요 시 ALTER TABLE "Booking" DROP COLUMN "policyConsentJson";
--
-- 스냅샷 내용(서버 산출 — 클라 값 불신):
--   { agreedAt: ISO, policy: { fullDays, partialDays, partialPct }, locale, source: "proposal" }
-- ★금액·마진 컬럼 없음(정책 %·일수만). CANCELLATION_POLICY.enabled=false면 미요구·NULL.

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "policyConsentJson" JSONB;
