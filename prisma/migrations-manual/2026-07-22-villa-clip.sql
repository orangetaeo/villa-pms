-- 2026-07-22 villa-clip-narration P1 — 빌라 영상 클립(VillaClip)
-- 규약: additive raw SQL only (prisma migrate dev / db push 금지 — CLAUDE.md 스키마 변경 규약).
-- 적용 후 `npx prisma generate` 필수.
--
-- 기존 테이블/컬럼 변경 없음. 신규 enum 1개 + 신규 테이블 1개 + 인덱스 3개.
-- 롤백: DROP TABLE "VillaClip"; DROP TYPE "VillaClipStatus";  (신규 객체뿐이라 기존 데이터 영향 0)

BEGIN;

-- 1) 상태 enum — 존재하면 건너뜀(재실행 안전)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VillaClipStatus') THEN
    CREATE TYPE "VillaClipStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'APPROVED', 'REJECTED');
  END IF;
END
$$;

-- 2) 테이블
CREATE TABLE IF NOT EXISTS "VillaClip" (
  "id"              TEXT NOT NULL,
  "villaId"         TEXT NOT NULL,
  "r2Key"           TEXT NOT NULL,
  "url"             TEXT NOT NULL,
  "mimeType"        TEXT NOT NULL,
  "sizeBytes"       INTEGER NOT NULL,
  "durationSec"     INTEGER NOT NULL,
  "width"           INTEGER NOT NULL,
  "height"          INTEGER NOT NULL,
  "space"           "PhotoSpace",
  "note"            TEXT,
  "status"          "VillaClipStatus" NOT NULL DEFAULT 'UPLOADING',
  "rejectionReason" TEXT,
  "reviewedBy"      TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "uploadedBy"      TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VillaClip_pkey" PRIMARY KEY ("id")
);

-- 3) FK — 빌라 삭제 시 클립도 삭제(Cascade). 발행된 쇼츠의 산출물은 youtube-renders/ 별도 키라 영향 없음.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VillaClip_villaId_fkey'
  ) THEN
    ALTER TABLE "VillaClip"
      ADD CONSTRAINT "VillaClip_villaId_fkey"
      FOREIGN KEY ("villaId") REFERENCES "Villa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- 4) 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS "VillaClip_r2Key_key" ON "VillaClip"("r2Key");
CREATE INDEX IF NOT EXISTS "VillaClip_villaId_status_idx" ON "VillaClip"("villaId", "status");
CREATE INDEX IF NOT EXISTS "VillaClip_status_createdAt_idx" ON "VillaClip"("status", "createdAt");

COMMIT;
