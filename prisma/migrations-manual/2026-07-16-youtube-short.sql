-- 2026-07-16 — 유튜브 쇼츠 자동 업로드 S1 (additive, 계약서 youtube-shorts-s1 §3)
-- YoutubeShort + enum YtShortStatus/YtSourceType.
--
-- 설계 메모 (TDA):
--   - YtShortStatus는 IgPostStatus와 값 셋이 현재 동일(7종)하지만 별도 신설:
--     ① Prisma enum명=Postgres 타입명 — 유튜브 행에 Ig* 타입 박제는 의미 혼란, 이후 개명은 non-additive.
--     ② 플랫폼 독립 진화 — YT 전용 상태 추가 시 공유 enum이면 IgPostStatus 전 소비처
--        (exhaustive switch·narrow 함수)에 파급 (vendorSettleMethod 회귀 교훈).
--     ③ 중복 비용(안정 라이프사이클 7값) < 결합 비용.
--   - villaId FK = ON DELETE SET NULL — 빌라 삭제 시 발행 이력(ytVideoId) 보존.
--   - instagramPostId FK = ON DELETE SET NULL — 동일 콘텐츠 2플랫폼 연결, 포스트 삭제 시 쇼츠 보존.
--   - YtSourceType.UPLOADED는 S2(직접 촬영 업로드) 대비 선반영.
--
-- AppSetting 신규 키 (값 세팅은 INTEG/OPS 몫 — 여기서는 문서화만. 암호화=lib/secret-crypto, 키=ZALO_CREDS_KEY):
--   YT_CLIENT_ID          — GCP OAuth 클라이언트 ID (공개 식별자 — 평문 가능)
--   YT_CLIENT_SECRET      — OAuth 클라이언트 시크릿. ★AES-256-GCM 암호화 저장
--   YT_REFRESH_TOKEN      — OAuth refresh token. ★암호화 저장
--   YT_ACCESS_TOKEN_CACHE — access token 캐시 JSON {token, expiresAt}. ★암호화 저장
--   YT_AUTOPOST_PAUSED    — 자동 업로드 킬스위치. 기본 "1"(정지 상태로 시작)
--   YT_SHORTS_PER_DAY     — 일 쇼츠 초안 수. 기본 0=끔(미설정=0 취급)
--   YT_PRIVACY_STATUS     — 업로드 privacyStatus. 기본 "unlisted"(API 감사 전 안전값)
--   YT_DAILY_UPLOAD_CAP   — 일 업로드 상한(쿼터 가드). 기본 6
--   YT_OAUTH_STATE        — OAuth CSRF state 임시 저장(콜백 검증 후 삭제)
--
-- 신규 enum이므로 CREATE TYPE — idempotent 위해 DO 블록 duplicate_object 흡수.

DO $$ BEGIN
  CREATE TYPE "YtShortStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "YtSourceType" AS ENUM ('VILLA_AUTO', 'UPLOADED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "YoutubeShort" (
  "id" TEXT NOT NULL,
  "villaId" TEXT,
  "instagramPostId" TEXT,
  "sourceType" "YtSourceType" NOT NULL,
  "status" "YtShortStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "tags" JSONB NOT NULL,
  "videoUrl" TEXT NOT NULL,
  "posterUrl" TEXT,
  "durationSec" INTEGER,
  "ytVideoId" TEXT,
  "ytPrivacyStatus" TEXT,
  "publishedAt" TIMESTAMP(3),
  "failReason" TEXT,
  "flaggedTerms" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YoutubeShort_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "YoutubeShort_villaId_fkey" FOREIGN KEY ("villaId") REFERENCES "Villa"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "YoutubeShort_instagramPostId_fkey" FOREIGN KEY ("instagramPostId") REFERENCES "InstagramPost"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "YoutubeShort_status_scheduledAt_idx" ON "YoutubeShort"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "YoutubeShort_villaId_idx" ON "YoutubeShort"("villaId");
