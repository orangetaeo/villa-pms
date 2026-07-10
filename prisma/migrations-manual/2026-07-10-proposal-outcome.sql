-- 2026-07-10 시간제안 소비자 승인/거절 (ADR-0035) — additive만
-- 최신 제안 결과 스냅샷: APPLIED(적용) | DECLINED(고객 거절) | DISMISSED(운영자 무시)
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "vendorProposalOutcome" TEXT;
