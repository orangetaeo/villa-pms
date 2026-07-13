-- 2026-07-13 운영자 알림 그룹 발송 (ADR-0039, zalo-admin-group-notify)
-- Notification.groupThreadId: 설정 시 dispatchOne이 시스템봇 ThreadType.Group으로 발송.
-- 인덱스 없음 — dispatch 쿼리는 channel+status 기준, groupThreadId로 필터하지 않음.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "groupThreadId" TEXT;
