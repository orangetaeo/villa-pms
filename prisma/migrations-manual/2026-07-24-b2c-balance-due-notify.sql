-- 2026-07-24 · T-b2c-staged-payment P4 (ADR-0048) — B2C 잔금 도래 운영자 알림 타입
--
-- additive only. NotificationType에 B2C_BALANCE_DUE 추가(체크인 D-14 잔금 청구 도래 → 운영자 통지).
-- ALTER TYPE ADD VALUE는 트랜잭션 밖. 적용 후 `npx prisma generate` 필수.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'B2C_BALANCE_DUE';
