-- T-complex-area-master (ADR-0046): 지역(단지) 마스터 + Villa FK — additive only
-- 적용: 2026-07-21, Railway 라이브 DB에 직접 실행 (prisma migrate dev / db push 금지 규약)
-- 주의: WebChatMessage 관련 SQL은 이 파일에 포함하지 않는다 (T-webchat-cards 세션 소관).

CREATE TABLE IF NOT EXISTS "ComplexArea" (
  "id"        TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "nameKo"    TEXT,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplexArea_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ComplexArea_code_key" ON "ComplexArea"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "ComplexArea_name_key" ON "ComplexArea"("name");

ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "complexAreaId" TEXT;
CREATE INDEX IF NOT EXISTS "Villa_complexAreaId_idx" ON "Villa"("complexAreaId");

-- PG는 ADD CONSTRAINT IF NOT EXISTS 미지원 — DO 블록으로 멱등 처리
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Villa_complexAreaId_fkey') THEN
    ALTER TABLE "Villa"
      ADD CONSTRAINT "Villa_complexAreaId_fkey"
      FOREIGN KEY ("complexAreaId") REFERENCES "ComplexArea"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
