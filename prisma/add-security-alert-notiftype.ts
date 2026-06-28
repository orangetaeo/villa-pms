/**
 * NotificationType enum에 SECURITY_ALERT 값 additive 적용 (수동 1회용, 보안 P3-S3).
 * 공유 Neon DB라 `prisma db push` 금지 → raw SQL ALTER TYPE ADD VALUE로만 적용.
 * 멱등: IF NOT EXISTS — 재실행 안전. 기존 값·구코드 무영향(새 값 미참조).
 *
 * 실행: npx tsx --env-file=.env prisma/add-security-alert-notiftype.ts
 * ⚠ ALTER TYPE ADD VALUE는 트랜잭션 밖에서 실행돼야 한다($executeRawUnsafe 단독 호출이라 OK).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SECURITY_ALERT'`,
  );
  const rows = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
       WHERE t.typname = 'NotificationType' AND e.enumlabel = 'SECURITY_ALERT'
     ) AS ok`,
  );
  console.log(rows[0]?.ok ? "✅ NotificationType.SECURITY_ALERT 적용 완료" : "⚠️ 값 미존재");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
