-- 2026-07-16 — marketing-s2 스키마 additive (계약서 docs/contracts/marketing-s2.md §A-3·§B·§D)
-- 전 구문 idempotent — 2회 실행 무해.
--
-- 설계 메모 (TDA):
--   1) YtEditJobStatus = 신설 enum, YtShortStatus(발행 라이프사이클)와 별개 축.
--      편집(렌더) 파이프라인 전용 — DONE 후 승인 큐 합류는 status(DRAFT→PENDING_APPROVAL)가 담당.
--      nullable: null=편집 잡 아님(VILLA_AUTO 전부 null). PROCESSING 락은 조건부 update
--      (where editJobStatus=PENDING)로 획득 — BE 구현 시 준수.
--   2) 편집 잡 폴링 인덱스 = 일반 인덱스 (editJobStatus).
--      부분 인덱스(WHERE ... IN ('PENDING','PROCESSING'))가 이론상 더 작지만 Prisma 스키마로
--      표현 불가(스키마↔DB 드리프트) + 테이블 볼륨(쇼츠 행)이 작아 이득 무의미 → 스키마 정합 우선.
--   3) IgInsightScope에 YT_MEDIA additive (별도 enum·테이블 기각):
--      InstagramInsightSnapshot은 metricsJson 기반 범용 스냅샷 저장소 — 별도 테이블은
--      unique(@@unique[scope,igMediaId,capturedOn])·인덱스·cron upsert 로직 중복만 낳는다.
--      YtShortStatus를 분리했던 근거(exhaustive switch 파급)는 IgInsightScope에 해당 없음
--      — 소비처 전수 grep(2026-07-16): lib/instagram/insights.ts·app/api/instagram/insights/summary
--      모두 where 필터로 좁혀 쓰기만 → YT_MEDIA 행은 자연 배제, 회귀 없음.
--      YT_MEDIA 행의 igMediaId 컬럼에는 ytVideoId를 저장한다(컬럼명 wart 승인 — rename은 non-additive).
--   4) NotificationType에 MARKETING_ALERT 1값 additive — 세부 구분(IG 초안·발행실패·YT 토큰·편집 잡)은
--      payload 분기(타입 증식 금지 교훈). lib/zalo.ts buildNotificationText exhaustive switch에
--      정식 case 스텁 추가로 tsc 0 유지(본문 구현=BE 몫). GROUP_ROUTED_TYPES 등재도 BE 몫(§D).
--   5) 성과 캐시(latest*) = 뱃지·정렬용 최신값. 추이 정본은 InstagramInsightSnapshot(scope=YT_MEDIA).

-- §A-3: 편집 잡 상태 enum (신설 — DO 블록 duplicate_object 흡수로 멱등)
DO $$ BEGIN
  CREATE TYPE "YtEditJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §A-3: YoutubeShort 편집 잡 컬럼 4종
ALTER TABLE "YoutubeShort" ADD COLUMN IF NOT EXISTS "editJobStatus" "YtEditJobStatus";
ALTER TABLE "YoutubeShort" ADD COLUMN IF NOT EXISTS "editParamsJson" JSONB;
ALTER TABLE "YoutubeShort" ADD COLUMN IF NOT EXISTS "editError" TEXT;
ALTER TABLE "YoutubeShort" ADD COLUMN IF NOT EXISTS "sourceClipsJson" JSONB;

-- §A-3: 편집 잡 폴링 인덱스 (설계 메모 2 — 일반 인덱스, Prisma @@index([editJobStatus])와 정합)
CREATE INDEX IF NOT EXISTS "YoutubeShort_editJobStatus_idx" ON "YoutubeShort"("editJobStatus");

-- §B: 성과 캐시 컬럼 4종
ALTER TABLE "YoutubeShort" ADD COLUMN IF NOT EXISTS "latestViews" INTEGER;
ALTER TABLE "YoutubeShort" ADD COLUMN IF NOT EXISTS "latestLikes" INTEGER;
ALTER TABLE "YoutubeShort" ADD COLUMN IF NOT EXISTS "latestComments" INTEGER;
ALTER TABLE "YoutubeShort" ADD COLUMN IF NOT EXISTS "statsSyncedAt" TIMESTAMP(3);

-- §B: 인사이트 스냅샷 scope 확장 (설계 메모 3)
ALTER TYPE "IgInsightScope" ADD VALUE IF NOT EXISTS 'YT_MEDIA';

-- §D: 마케팅 알림 타입 (설계 메모 4)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MARKETING_ALERT';
