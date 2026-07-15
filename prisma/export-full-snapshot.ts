/**
 * 전체 DB 논리 백업 — 모든 모델의 전 행을 JSON으로 스냅샷 (2026-07-09).
 * pg_dump 버전 불일치(서버 PG18 vs 로컬 17) 대체. 스키마는 git schema.prisma에 있으므로 데이터만 확보.
 *   실행: npx tsx --env-file=.env prisma/export-full-snapshot.ts <출력경로.json>
 *
 * 스냅샷 로직은 lib/db-snapshot.ts로 추출됨(cron 라우트 /api/cron/db-backup과 공유). CLI 인터페이스 불변.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
import { snapshotAllModels, serializeSnapshot } from "../lib/db-snapshot";

const prisma = new PrismaClient();
const OUT = process.argv[2] || "full-snapshot.json";

async function main() {
  const { dump, modelCount, rowCount } = await snapshotAllModels(prisma);
  for (const [name, rows] of Object.entries(dump)) {
    if (rows.length) console.log(`  ${name.padEnd(28)} ${String(rows.length).padStart(7)}`);
  }
  const json = serializeSnapshot(dump);
  writeFileSync(OUT, json);
  console.log(`\n✅ 전체 ${rowCount}행 · ${modelCount} 모델 → ${OUT} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
}

main()
  .catch((e) => { console.error("❌ 스냅샷 실패:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
