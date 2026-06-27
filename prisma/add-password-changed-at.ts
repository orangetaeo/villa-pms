/**
 * User.passwordChangedAt 컬럼 additive 적용 (수동 1회용, 보안 P0-5②).
 * 공유 Neon DB라 `prisma db push` 금지(드리프트/드롭 위험) → raw SQL ALTER로만 적용.
 * 멱등: ADD COLUMN IF NOT EXISTS — 재실행해도 안전. nullable이라 구코드(select 미참조) 무영향.
 *
 * 실행: npx tsx --env-file=.env prisma/add-password-changed-at.ts
 * 대상 DB = .env DATABASE_URL.
 *
 * Prisma DateTime? → Postgres timestamp(3). (NULL=기능 도입 후 한 번도 안 바꿈 → 코드에서 epoch 0 취급)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" timestamp(3)`,
  );
  // 검증 — 컬럼 존재 확인
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM information_schema.columns
     WHERE table_name = 'User' AND column_name = 'passwordChangedAt'`,
  );
  const exists = Number(rows[0]?.count ?? 0) > 0;
  console.log(exists ? "✅ User.passwordChangedAt 적용 완료(존재 확인)" : "⚠️ 컬럼 미존재");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
