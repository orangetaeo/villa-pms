/**
 * 전체 DB 논리 백업 — 모든 모델의 전 행을 JSON으로 스냅샷 (2026-07-09).
 * pg_dump 버전 불일치(서버 PG18 vs 로컬 17) 대체. 스키마는 git schema.prisma에 있으므로 데이터만 확보.
 *   실행: npx tsx --env-file=.env prisma/export-full-snapshot.ts <출력경로.json>
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { writeFileSync } from "fs";

const prisma = new PrismaClient();
const OUT = process.argv[2] || "full-snapshot.json";

async function main() {
  const models = Prisma.dmmf.datamodel.models;
  const dump: Record<string, unknown[]> = {};
  let total = 0;
  for (const m of models) {
    const prop = m.name[0].toLowerCase() + m.name.slice(1);
    const client: any = (prisma as any)[prop];
    if (!client?.findMany) continue;
    const rows = await client.findMany();
    dump[m.name] = rows;
    total += rows.length;
    if (rows.length) console.log(`  ${m.name.padEnd(28)} ${String(rows.length).padStart(7)}`);
  }
  const json = JSON.stringify(dump, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 0);
  writeFileSync(OUT, json);
  console.log(`\n✅ 전체 ${total}행 · ${models.length} 모델 → ${OUT} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
}

main()
  .catch((e) => { console.error("❌ 스냅샷 실패:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
