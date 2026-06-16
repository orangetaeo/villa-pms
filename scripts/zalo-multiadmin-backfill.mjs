// ADR-0007 S0 — 멀티 관리자 Zalo 백필 (프로덕션 데이터 손실 0)
//
// 순서 (D7 2단계 마이그레이션의 "A" — additive + 백필):
//   1) ZaloAccountKind enum 생성 (없으면)
//   2) ZaloAccount.kind 컬럼 추가(nullable→default) + 기존 행 SYSTEM_BOT 백필
//   3) ZaloAccount.userId NOT NULL 보장: 기존 행 userId 없으면 테오로 set (이미 set이면 무변경)
//   4) ZaloConversation.ownerAdminId 컬럼 추가(nullable) + 기존 행 = 테오(시스템봇 소유자) 백필
//
// 이 스크립트는 컬럼/제약 "추가"와 "값 채우기"만 한다. NOT NULL 전환·복합 unique 교체·
// 기존 @unique 제거는 이후 `prisma db push`가 수행한다(이미 값이 채워져 있으므로 안전).
//
// 멱등: 재실행해도 안전(IF NOT EXISTS / 조건부 UPDATE).
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 시스템봇 소유자(테오 ADMIN). inspect 결과로 확정.
const THEO_ADMIN_ID = "cmq9dzydp0000uk94gx0ip100";

async function exec(sql) {
  await prisma.$executeRawUnsafe(sql);
}

try {
  console.log("=== ADR-0007 S0 백필 시작 ===");

  // 0) 테오 ADMIN 존재 확인 (백필 기준점 — 없으면 중단)
  const theo = await prisma.user.findFirst({
    where: { id: THEO_ADMIN_ID, role: "ADMIN" },
    select: { id: true, name: true },
  });
  if (!theo) {
    throw new Error(`시스템봇 소유자(테오) ADMIN ${THEO_ADMIN_ID} 없음 — 백필 중단(데이터 손실 방지)`);
  }
  console.log(`시스템봇 소유자 확인: ${theo.name} (${theo.id})`);

  // 1) ZaloAccountKind enum 생성
  await exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ZaloAccountKind') THEN
      CREATE TYPE "ZaloAccountKind" AS ENUM ('SYSTEM_BOT', 'ADMIN_PERSONAL');
    END IF;
  END $$;`);
  console.log("1) ZaloAccountKind enum OK");

  // 2) ZaloAccount.kind 컬럼 추가 (default SYSTEM_BOT) — 기존 행은 default로 채워짐
  await exec(
    `ALTER TABLE "ZaloAccount" ADD COLUMN IF NOT EXISTS "kind" "ZaloAccountKind" NOT NULL DEFAULT 'SYSTEM_BOT';`
  );
  // 명시 백필(이미 존재하던 NULL 케이스 방어 — 기본은 default가 처리)
  const kindRes = await prisma.$executeRawUnsafe(
    `UPDATE "ZaloAccount" SET "kind" = 'SYSTEM_BOT' WHERE "kind" IS NULL;`
  );
  console.log(`2) ZaloAccount.kind 추가 + SYSTEM_BOT 백필 (보정 ${kindRes}건)`);

  // 3) ZaloAccount.userId — 기존 행 userId NULL이면 테오로 set (NOT NULL 전환 전제)
  const acctNullUser = await prisma.$executeRawUnsafe(
    `UPDATE "ZaloAccount" SET "userId" = '${THEO_ADMIN_ID}' WHERE "userId" IS NULL;`
  );
  console.log(`3) ZaloAccount.userId NULL→테오 백필 (${acctNullUser}건)`);

  // 4) ZaloConversation.ownerAdminId 컬럼 추가 (우선 nullable) + 기존 행 테오 백필
  await exec(
    `ALTER TABLE "ZaloConversation" ADD COLUMN IF NOT EXISTS "ownerAdminId" TEXT;`
  );
  const convBackfill = await prisma.$executeRawUnsafe(
    `UPDATE "ZaloConversation" SET "ownerAdminId" = '${THEO_ADMIN_ID}' WHERE "ownerAdminId" IS NULL;`
  );
  console.log(`4) ZaloConversation.ownerAdminId 추가 + 테오 백필 (${convBackfill}건)`);

  // 검증 — NULL 잔존 0 이어야 db push의 NOT NULL 전환이 성공
  const acctNullCnt = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM "ZaloAccount" WHERE "userId" IS NULL OR "kind" IS NULL;`
  );
  const convNullCnt = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM "ZaloConversation" WHERE "ownerAdminId" IS NULL;`
  );
  console.log("--- 검증 ---");
  console.log(`ZaloAccount userId/kind NULL 잔존: ${acctNullCnt[0].c} (0 이어야 함)`);
  console.log(`ZaloConversation ownerAdminId NULL 잔존: ${convNullCnt[0].c} (0 이어야 함)`);

  if (acctNullCnt[0].c !== 0 || convNullCnt[0].c !== 0) {
    throw new Error("NULL 잔존 — db push 금지(NOT NULL 전환 실패 위험). 원인 조사 필요");
  }

  // 복합 unique 충돌 사전 검사 — (ownerAdminId, zaloUserId) 중복이 있으면 db push 실패
  const dupConv = await prisma.$queryRawUnsafe(
    `SELECT "ownerAdminId", "zaloUserId", COUNT(*)::int AS c
       FROM "ZaloConversation" GROUP BY "ownerAdminId", "zaloUserId" HAVING COUNT(*) > 1;`
  );
  const dupAcct = await prisma.$queryRawUnsafe(
    `SELECT "userId", "kind", COUNT(*)::int AS c
       FROM "ZaloAccount" GROUP BY "userId", "kind" HAVING COUNT(*) > 1;`
  );
  console.log(`ZaloConversation (ownerAdminId,zaloUserId) 중복: ${dupConv.length} (0 이어야 함)`);
  console.log(`ZaloAccount (userId,kind) 중복: ${dupAcct.length} (0 이어야 함)`);
  if (dupConv.length > 0 || dupAcct.length > 0) {
    throw new Error("복합 unique 충돌 — db push 금지. 중복 데이터 정리 필요");
  }

  console.log("=== 백필 완료 — 이제 `prisma db push` 안전 (NOT NULL + 복합 unique 전환만 수행) ===");
} catch (e) {
  console.error("BACKFILL_ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
