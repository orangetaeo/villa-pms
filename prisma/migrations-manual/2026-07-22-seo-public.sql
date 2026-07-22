-- T-seo-s1 — 공개 SEO 노출 플래그 (additive only)
-- 적용 대상: Railway Postgres(라이브). prisma migrate dev·db push 사용 금지 규약에 따른 raw SQL 정본.
-- 적용 후 반드시: npx prisma generate
--
-- 안전성: 전부 additive. 기존 컬럼 변경·삭제 없음. publicListed 기본 false이므로
--         적용 즉시 공개되는 빌라는 0개다(운영자가 켜야만 노출).
-- ⚠ 배포 순서: 이 SQL을 라이브에 먼저 적용한 뒤 코드를 배포한다.
--   (코드가 먼저 나가면 sitemap·공개 조회에서 컬럼 부재로 런타임 오류)

ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "publicSlug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Villa_publicSlug_key" ON "Villa"("publicSlug");

ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "publicListed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "publicListedAt" TIMESTAMP(3);

-- 공개 대상 조회(sitemap·페이지 생성)는 publicListed 필터가 항상 선행하므로 부분 인덱스로 충분.
CREATE INDEX IF NOT EXISTS "Villa_publicListed_idx" ON "Villa"("publicListed") WHERE "publicListed" = true;
