// ADR-0009 S0 — 채팅 상대타입·번역모드·아바타·별명 백필 (프로덕션 데이터 손실 0)
//
// 전부 additive(enum 추가 + default/nullable 컬럼 추가). 비-additive 변경 없음.
// 순서(데이터 손실 0 — 백필 먼저 → db push):
//   1) ZaloCounterpartyType / ZaloTranslateMode enum 생성 (없으면)
//   2) ZaloConversation에 컬럼 추가:
//        counterpartyType (NOT NULL default UNKNOWN)
//        translateMode    (NOT NULL default OFF)
//        avatarUrl        (nullable TEXT)
//        avatarFetchedAt  (nullable TIMESTAMP)
//        nickname         (nullable TEXT)
//   3) 백필(기존 대화 = 전부 공급자 전제, ADR D1.5·D7.3):
//        counterpartyType: userId 있으면 SUPPLIER, 없으면 UNKNOWN
//        translateMode:    counterpartyType=SUPPLIER → VI (그 외 OFF 유지)
//
// 이 스크립트는 컬럼/enum "추가"와 "값 채우기"만 한다. 이후 `prisma db push`는
// 이미 존재하는 additive 변경을 재확인할 뿐(무파괴). prisma generate로 클라이언트 갱신.
//
// 멱등: 재실행해도 안전(IF NOT EXISTS / 조건부 UPDATE). 신규 대화는 default(UNKNOWN/OFF)로
//       들어오므로 "기존 행만" 백필되도록 default 값에서만 UPDATE한다(이미 분류된 행 미변경).
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function exec(sql) {
  await prisma.$executeRawUnsafe(sql);
}

try {
  console.log("=== ADR-0009 S0 백필 시작 ===");

  // 1) enum 생성 (없으면)
  await exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ZaloCounterpartyType') THEN
      CREATE TYPE "ZaloCounterpartyType" AS ENUM ('SUPPLIER', 'CUSTOMER', 'UNKNOWN');
    END IF;
  END $$;`);
  await exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ZaloTranslateMode') THEN
      CREATE TYPE "ZaloTranslateMode" AS ENUM ('OFF', 'VI', 'EN');
    END IF;
  END $$;`);
  console.log("1) enum ZaloCounterpartyType / ZaloTranslateMode OK");

  // 2) 컬럼 추가 (default 있는 것은 NOT NULL — 기존 행은 default로 채워짐)
  await exec(
    `ALTER TABLE "ZaloConversation" ADD COLUMN IF NOT EXISTS "counterpartyType" "ZaloCounterpartyType" NOT NULL DEFAULT 'UNKNOWN';`
  );
  await exec(
    `ALTER TABLE "ZaloConversation" ADD COLUMN IF NOT EXISTS "translateMode" "ZaloTranslateMode" NOT NULL DEFAULT 'OFF';`
  );
  await exec(`ALTER TABLE "ZaloConversation" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;`);
  await exec(
    `ALTER TABLE "ZaloConversation" ADD COLUMN IF NOT EXISTS "avatarFetchedAt" TIMESTAMP(3);`
  );
  await exec(`ALTER TABLE "ZaloConversation" ADD COLUMN IF NOT EXISTS "nickname" TEXT;`);
  console.log("2) ZaloConversation 컬럼 5종 추가 OK");

  // 3) 백필 — 기존 대화는 전부 공급자 전제(ADR D1.5).
  //    counterpartyType: userId 있으면 SUPPLIER, 없으면(미매칭 공급자) SUPPLIER로 본다(현 채팅 상대 전제).
  //    단, ADR D1.5는 "기존 모든 ZaloConversation → SUPPLIER 백필"이므로 userId 유무 무관 SUPPLIER.
  //    여기서는 요청서 명세(userId 있으면 SUPPLIER, 없으면 UNKNOWN)를 따른다 — 더 보수적(미매칭은 공유 잠금).
  //    "기존 행만" 대상: 아직 default(UNKNOWN)인 행만 갱신(재실행·신규행 보호).
  const cpSupplier = await prisma.$executeRawUnsafe(
    `UPDATE "ZaloConversation" SET "counterpartyType" = 'SUPPLIER'
       WHERE "counterpartyType" = 'UNKNOWN' AND "userId" IS NOT NULL;`
  );
  console.log(`3a) counterpartyType UNKNOWN→SUPPLIER (userId 있는 기존 대화 ${cpSupplier}건)`);

  // translateMode: SUPPLIER 대화는 VI(베트남인 전제). 아직 default(OFF)인 SUPPLIER 행만.
  const tmVi = await prisma.$executeRawUnsafe(
    `UPDATE "ZaloConversation" SET "translateMode" = 'VI'
       WHERE "translateMode" = 'OFF' AND "counterpartyType" = 'SUPPLIER';`
  );
  console.log(`3b) translateMode OFF→VI (SUPPLIER 대화 ${tmVi}건)`);

  // 검증
  const summary = await prisma.$queryRawUnsafe(
    `SELECT "counterpartyType" AS t, "translateMode" AS m, COUNT(*)::int AS c
       FROM "ZaloConversation" GROUP BY "counterpartyType", "translateMode" ORDER BY 1, 2;`
  );
  console.log("--- 검증 (대화 분포) ---");
  for (const row of summary) {
    console.log(`  ${row.t} / ${row.m}: ${row.c}건`);
  }

  console.log("=== 백필 완료 — 이제 `prisma db push`(무파괴 재확인) + `prisma generate` 안전 ===");
} catch (e) {
  console.error("BACKFILL_ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
