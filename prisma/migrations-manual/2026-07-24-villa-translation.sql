-- 2026-07-24 VillaTranslation — 빌라 공개 소개문(description) 비-ko 번역 (ADR-0050 Phase 2)
--
-- 실운영 규약(CLAUDE.md): prisma migrate dev·db push 금지. 라이브 DB(Railway)에는 이 additive raw SQL을
-- 직접 적용하고, 적용본을 이 파일로 보존한다(감사 추적 정본). 적용 후 `npx prisma generate` 필수.
--
-- ★ SeoArticleTranslation 패턴 축소판: villaId+locale 유니크, description 단일 텍스트, sourceHash=sha256(description),
--   status READY/FAILED. FK Villa onDelete Cascade.

CREATE TABLE IF NOT EXISTS "VillaTranslation" (
  "id"           TEXT NOT NULL,
  "villaId"      TEXT NOT NULL,
  "locale"       TEXT NOT NULL,
  "description"  TEXT NOT NULL,
  "sourceHash"   TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'READY',
  "errorNote"    TEXT,
  "model"        TEXT,
  "translatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VillaTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VillaTranslation_villaId_locale_key"
  ON "VillaTranslation" ("villaId", "locale");

CREATE INDEX IF NOT EXISTS "VillaTranslation_locale_status_idx"
  ON "VillaTranslation" ("locale", "status");

-- FK는 이미 존재하면 재적용하지 않도록 방어(중복 적용 안전).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VillaTranslation_villaId_fkey'
  ) THEN
    ALTER TABLE "VillaTranslation"
      ADD CONSTRAINT "VillaTranslation_villaId_fkey"
      FOREIGN KEY ("villaId") REFERENCES "Villa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
