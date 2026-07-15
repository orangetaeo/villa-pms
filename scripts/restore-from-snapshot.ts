/**
 * DB 복원 — lib/db-snapshot 스냅샷(.json 또는 .json.gz)을 빈 DB로 복원 (T-db-backup-automation).
 *
 *   드라이런(기본): npx tsx --env-file=.env scripts/restore-from-snapshot.ts <경로>
 *     → 파싱·모델별 행 수·복원 순서만 출력. DB 미변경.
 *   실행:           npx tsx --env-file=.env scripts/restore-from-snapshot.ts <경로> --execute [--force]
 *     → 각 테이블 트리거 비활성(FK 순서 무관) → createMany → 트리거 복구.
 *
 * ★ 안전장치
 *   - 대상 DB에 기존 행이 있으면 기본 중단(`--force`로만 무시). DROP/TRUNCATE 자동 실행 없음
 *     (파괴적 초기화는 런북 docs/ops/db-backup.md의 수동 절차로만).
 *   - `DISABLE/ENABLE TRIGGER ALL`은 테이블 owner 권한 필요(복원 대상 DB 소유자로 실행할 것).
 *
 * ★ 왕복(round-trip)
 *   - BigInt: 스냅샷의 `"123n"`(음수 `"-5n"` 포함) → BigInt로 역변환(아래 reviveBigInt).
 *   - Date/Json/enum/null: findMany 결과를 그대로 createMany에 투입 — Prisma가 ISO 문자열(DateTime)·
 *     객체(Json)·문자열(enum)·null을 수용하므로 별도 변환 불필요(BigInt만 특수 처리).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { readFileSync } from "fs";
import { gunzipSync } from "node:zlib";

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const SNAPSHOT_PATH = argv.find((a) => !a.startsWith("--"));
const EXECUTE = argv.includes("--execute");
const FORCE = argv.includes("--force");

/** `"123n"`/`"-5n"` 문자열 → BigInt 역변환. 그 외 값은 그대로. */
function reviveBigInt(_key: string, value: unknown): unknown {
  if (typeof value === "string" && /^-?\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  return value;
}

/** dmmf 모델명 → 실제 테이블명(@@map 있으면 dbName, 없으면 모델명). PascalCase는 큰따옴표 인용 필요. */
function tableNameFor(modelName: string): string {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  return model?.dbName ?? modelName;
}

/** 모델명 → Prisma 클라이언트 프로퍼티(첫 글자 소문자). */
function clientProp(modelName: string): string {
  return modelName[0].toLowerCase() + modelName.slice(1);
}

function loadSnapshot(path: string): Record<string, unknown[]> {
  const raw = readFileSync(path);
  const text = path.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const parsed = JSON.parse(text, reviveBigInt);
  if (!parsed || typeof parsed !== "object") throw new Error("스냅샷 형식 오류(객체 아님)");
  return parsed as Record<string, unknown[]>;
}

async function main() {
  if (!SNAPSHOT_PATH) {
    console.error("사용법: tsx scripts/restore-from-snapshot.ts <스냅샷.json|.json.gz> [--execute] [--force]");
    process.exit(1);
  }

  console.log(`📥 스냅샷 로드: ${SNAPSHOT_PATH}`);
  const dump = loadSnapshot(SNAPSHOT_PATH);
  const entries = Object.entries(dump);
  let total = 0;

  console.log(`\n복원 순서(모델별 행 수):`);
  for (const [modelName, rows] of entries) {
    const n = Array.isArray(rows) ? rows.length : 0;
    total += n;
    console.log(`  ${modelName.padEnd(28)} ${String(n).padStart(7)}  → "${tableNameFor(modelName)}"`);
  }
  console.log(`\n합계 ${total}행 · ${entries.length} 모델`);

  if (!EXECUTE) {
    console.log(`\nℹ️  드라이런(기본) — DB 미변경. 실제 복원은 --execute 추가.`);
    return;
  }

  // 기존 데이터 가드 — 하나라도 행이 있으면 --force 없이는 중단(덮어쓰기 사고 방지).
  if (!FORCE) {
    for (const [modelName] of entries) {
      const prop = clientProp(modelName);
      const client = (prisma as unknown as Record<string, { count?: () => Promise<number> }>)[prop];
      if (!client?.count) continue;
      const c = await client.count();
      if (c > 0) {
        console.error(
          `\n❌ 대상 DB에 기존 데이터 존재(${modelName}: ${c}행). ` +
            `--force로 무시하거나, 런북의 수동 초기화 절차 후 재시도하세요.`
        );
        process.exit(1);
      }
    }
  }

  console.log(`\n🔧 복원 시작(--execute)...`);
  for (const [modelName, rows] of entries) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const table = tableNameFor(modelName);
    const prop = clientProp(modelName);
    const client = (prisma as unknown as Record<string, { createMany?: (a: unknown) => Promise<{ count: number }> }>)[prop];
    if (!client?.createMany) {
      console.warn(`  ⚠ ${modelName}: createMany 불가(스킵)`);
      continue;
    }
    // FK 순서 무관 — 트리거(FK 제약 포함) 비활성 후 삽입, 복구.
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER ALL`);
    try {
      const res = await client.createMany({ data: rows, skipDuplicates: true });
      console.log(`  ${modelName.padEnd(28)} +${res.count}`);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER ALL`);
    }
  }
  console.log(`\n✅ 복원 완료 — ${total}행 시도.`);
}

main()
  .catch((e) => {
    console.error("❌ 복원 실패:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
