-- 원본: scripts/sql/add-bedroom-sync-columns.sql (2026-07-10 라이브 적용 완료)
-- T-bedroom-composition-sync — Villa 신규 컬럼 additive (라이브 Railway Postgres 적용용)
-- ⚠ prisma db push 금지 [[db-is-railway-postgres]]. 이 파일을 OPS가 라이브 DB에 raw SQL로 실행한다.
-- additive(기존 컬럼 변경 없음) — 무중단. IF NOT EXISTS로 멱등.
--
-- 실행 예: psql "$DATABASE_URL" -f prisma/migrations-manual/2026-07-10-bedroom-sync-columns.sql
--
-- 참고: 출입정보(도어락/스마트키)는 기존 Villa.accessType/accessInfo 재사용(TDA 결정 — 신규 컬럼 없음).
--        따라서 이번 태스크의 신규 스키마는 commonBathrooms 1건뿐이다.

-- 공용 욕실(방에 속하지 않는 욕실) — Villa.bathrooms 파생 합산에 포함. default 0.
ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "commonBathrooms" INTEGER NOT NULL DEFAULT 0;
