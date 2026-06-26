/**
 * PasswordResetToken 테이블 additive 적용 (수동 1회용).
 * 공유 Neon DB라 `prisma db push` 금지(드리프트/드롭 위험) → raw SQL CREATE TABLE로만 적용.
 * 멱등: IF NOT EXISTS — 재실행해도 안전.
 *
 * 실행: npx tsx --env-file=.env prisma/apply-password-reset-token.ts
 * 대상 DB = .env DATABASE_URL.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const sql = readFileSync(join(__dirname, "sql", "password-reset-token.sql"), "utf8");
  // $executeRawUnsafe로 멀티 스테이트먼트 실행 (DO $$ 블록 포함).
  // prisma는 단일 호출에 세미콜론 구분 다중 스테이트먼트를 허용하지 않으므로 분할 실행.
  const statements = splitSqlStatements(sql);
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
  // 검증 — 테이블·인덱스 존재 확인
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM information_schema.tables WHERE table_name = 'PasswordResetToken'`
  );
  const exists = Number(rows[0]?.count ?? 0) > 0;
  console.log(exists ? "✅ PasswordResetToken 적용 완료(존재 확인)" : "⚠️ 테이블 미존재");
}

/** 세미콜론 분할 — 단, DO $$ ... $$; 달러쿼팅 블록은 하나로 보존 */
function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inDollar = false;
  const lines = sql.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--") || trimmed.length === 0) continue;
    if (line.includes("$$")) {
      // 한 줄에 짝수개면 토글 무효, 홀수개면 토글
      const count = (line.match(/\$\$/g) ?? []).length;
      if (count % 2 === 1) inDollar = !inDollar;
    }
    buf += line + "\n";
    if (!inDollar && trimmed.endsWith(";")) {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
