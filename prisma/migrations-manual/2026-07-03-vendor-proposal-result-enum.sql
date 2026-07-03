-- 2026-07-03 일정 제안 결과 Zalo 회신용 NotificationType 값 추가 (vendor-followups2 계약 ③)
-- additive·멱등. ★배포 전 라이브 선적용 필수(새 코드가 이 값으로 Notification INSERT).
-- 적용: npx prisma db execute --file prisma/migrations-manual/2026-07-03-vendor-proposal-result-enum.sql --schema prisma/schema.prisma
-- 롤백: Postgres enum 값 제거는 지원 안 됨(값 미사용 상태로 두면 무해).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VENDOR_PROPOSAL_RESULT';
