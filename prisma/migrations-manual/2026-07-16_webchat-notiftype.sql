-- 2026-07-16 — ADR-0045: 웹 채팅 신규 문의 알림 NotificationType 값 추가 (additive·멱등)
-- 대화당 첫 메시지 즉시 + 후속 10분 디바운스로 운영자(테오) Zalo 그룹 통지(ko 미리보기, 판매가·마진 미포함).
-- ⚠ ALTER TYPE ADD VALUE 는 트랜잭션 안에서 실패할 수 있어 단독 문장·별도 파일로 분리(2026-07-16_webchat.sql와 분리 실행).
-- ★배포 전 라이브 선적용 필수(새 코드가 이 값으로 Notification INSERT).
-- 적용: npx prisma db execute --file prisma/migrations-manual/2026-07-16_webchat-notiftype.sql --schema prisma/schema.prisma
-- 롤백: Postgres enum 값 제거 미지원(값 미사용 상태로 두면 무해).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEBCHAT_NEW_MESSAGE';
