/**
 * VillaRatePeriod 소비자 직판가 컬럼 additive 적용 (ADR-0031, 수동 1회용).
 * 라이브 Railway Postgres 드리프트 방지로 `prisma db push` 금지 → raw SQL ALTER로만.
 * 멱등: ADD COLUMN IF NOT EXISTS ×4 — 재실행 안전. nullable/default라 구코드(미참조) 무영향.
 *
 * 실행: npx tsx --env-file=.env prisma/add-consumer-sale-price.ts
 *   (정션 worktree에서 tsx 모듈해석 실패 시: node --env-file=.env -r ts-node/register …
 *    또는 메인 폴더에서 실행. 대상 DB = .env DATABASE_URL)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "consumerMarginType", ddl: `"consumerMarginType" "MarginType" NOT NULL DEFAULT 'PERCENT'` },
  { name: "consumerMarginValue", ddl: `"consumerMarginValue" bigint NOT NULL DEFAULT 0` },
  { name: "consumerSalePriceVnd", ddl: `"consumerSalePriceVnd" bigint` },
  { name: "consumerSalePriceKrw", ddl: `"consumerSalePriceKrw" integer` },
];

async function main() {
  for (const c of COLUMNS) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "VillaRatePeriod" ADD COLUMN IF NOT EXISTS ${c.ddl}`
    );
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'VillaRatePeriod'
       AND column_name IN ('consumerMarginType','consumerMarginValue','consumerSalePriceVnd','consumerSalePriceKrw')`
  );
  const found = new Set(rows.map((r) => r.column_name));
  const missing = COLUMNS.filter((c) => !found.has(c.name)).map((c) => c.name);
  if (missing.length === 0) {
    console.log("✅ VillaRatePeriod 소비자가 컬럼 4개 적용 완료(존재 확인)");
  } else {
    console.error("⚠️ 미적용 컬럼:", missing.join(", "));
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
