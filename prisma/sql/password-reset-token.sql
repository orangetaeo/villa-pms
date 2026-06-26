-- PasswordResetToken — 비밀번호 자가재설정(Zalo 6자리 코드) 토큰 테이블 (additive).
-- 공유 Neon DB라 prisma db push 금지(드리프트/드롭 위험) → raw SQL로만 적용.
-- 멱등: IF NOT EXISTS — 재실행해도 안전. 컬럼 타입은 Prisma 매핑과 동일(text / timestamp(3) / integer).
-- 적용: npx tsx --env-file=.env prisma/apply-password-reset-token.ts
--       (또는 psql "$DATABASE_URL" -f prisma/sql/password-reset-token.sql)

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "codeHash"  TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "attempts"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx"
  ON "PasswordResetToken" ("userId");

CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx"
  ON "PasswordResetToken" ("expiresAt");

-- FK는 onDelete: Cascade (User 삭제 시 토큰 동반 삭제). 이미 있으면 추가 생략.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_userId_fkey'
  ) THEN
    ALTER TABLE "PasswordResetToken"
      ADD CONSTRAINT "PasswordResetToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
