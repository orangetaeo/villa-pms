// Nike↔villa Zalo — 별명(alias) 동기화 (ADR-0010 보강, ETL S3 후속)
//
//   npx tsx scripts/sync-nike-aliases.ts --dry-run     # 대상 건수·샘플만(쓰기 0)
//   npx tsx scripts/sync-nike-aliases.ts               # 본실행(nickname UPDATE) — villa 별명 null만 채움
//   npx tsx scripts/sync-nike-aliases.ts --overwrite   # villa에 이미 별명이 있어도 Nike 값으로 덮어씀
//
// 배경: S3 ETL은 스레드 displayName(Zalo 프로필명)만 이관하고, 테오가 Nike에서 지어둔 별명
//       (Nike `ZaloAlias`)은 가져오지 않았다 → villa `ZaloConversation.nickname`이 전부 null →
//       프로필명만 표시되고 별명이 유실됨. 이 스크립트가 Nike 별명을 villa nickname으로 일괄 이관한다.
//
// 소스: Nike PostgreSQL(env NIKE_DATABASE_URL, 읽기 전용) — etl-nike-zalo.ts와 동일하게
//       PrismaClient(datasourceUrl) + $queryRawUnsafe read만(write/delete 0, credentials 미select).
// 타깃: villa DB(lib/prisma) — 테오 스코프(ownerAdminId) ZaloConversation.nickname UPDATE.
// 매핑: Nike ZaloAlias.userId(Zalo 사용자 ID) == villa ZaloConversation.zaloUserId.
// 멱등: 기본은 nickname이 null/빈 값인 대화만 채움(재실행 안전). --overwrite로 강제 덮어쓰기.
// 보안: Nike read only, NIKE_DATABASE_URL 값 로그 미출력, credential·마진 비참조.
// 감사: 변경 대화마다 writeAuditLog(UPDATE/ZaloConversation/nickname old→new) — nickname route와 동일.
// 의존성: @prisma/client(villa + Nike datasourceUrl raw) + lib/audit-log — 신규 deps 0.

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";
import { writeAuditLog } from "@/lib/audit-log";

// villa SET_NICKNAME 규칙과 동일(conversations/[id] route·ext/nickname): 1~40자. 초과는 절단 + 경고.
const NICKNAME_MAX = 40;

interface NikeAliasRow {
  userId: string;
  alias: string;
}

function parseArgs(argv: string[]): { dryRun: boolean; overwrite: boolean } {
  return { dryRun: argv.includes("--dry-run"), overwrite: argv.includes("--overwrite") };
}

function makeNikeClient(url: string): PrismaClient {
  // datasourceUrl: 스키마는 villa 것이지만 raw SQL은 연결된 Nike DB에 그대로 실행된다.
  return new PrismaClient({ datasourceUrl: url });
}

async function main() {
  const { dryRun, overwrite } = parseArgs(process.argv.slice(2));
  console.log(`=== Nike→villa 별명 동기화 ${dryRun ? "(DRY-RUN — 쓰기 0)" : "(본실행)"}${overwrite ? " [OVERWRITE]" : ""} ===`);

  const nikeUrl = process.env.NIKE_DATABASE_URL;
  if (!nikeUrl) {
    console.error(
      "\n[별명동기화] 환경변수 NIKE_DATABASE_URL 이(가) 설정되지 않았습니다.\n" +
        "      Nike PostgreSQL(읽기 전용 권장) 연결 문자열을 설정한 뒤 다시 실행하세요.\n" +
        "      (값은 로그에 출력되지 않습니다.)"
    );
    process.exit(1);
  }
  const nikeTheoUserId = process.env.NIKE_THEO_USER_ID || "cmmdavtkx00001dqytx9v1ss2";

  // 테오 식별 (하드코딩 금지) — villa 정본 소유자.
  const ownerAdminId = await getSystemBotOwnerId();
  if (!ownerAdminId) {
    console.error(
      "[별명동기화] villa SYSTEM_BOT 소유자(테오)를 해석하지 못했습니다(getSystemBotOwnerId=null) — 중단."
    );
    process.exit(1);
  }
  console.log(`villa ownerAdminId(테오): ${ownerAdminId}`);

  const nike = makeNikeClient(nikeUrl);
  try {
    // Nike 테오 accountId (credentials 미select) — ETL과 동일.
    const accountRows = await nike.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "ZaloAccount" WHERE "userId" = $1 LIMIT 1`,
      nikeTheoUserId
    );
    if (accountRows.length === 0) {
      console.error(`[별명동기화] Nike 테오 ZaloAccount 없음(userId=${nikeTheoUserId}) — 중단.`);
      process.exit(1);
    }
    const nikeAccountId = accountRows[0].id;
    console.log(`Nike 테오 accountId: ${nikeAccountId}`);

    // 테오 계정의 모든 별명 조회.
    const aliasRows = await nike.$queryRawUnsafe<NikeAliasRow[]>(
      `SELECT "userId", "alias" FROM "ZaloAlias" WHERE "accountId" = $1`,
      nikeAccountId
    );
    console.log(`Nike 별명(ZaloAlias): ${aliasRows.length}건`);

    let updated = 0;
    let skippedExisting = 0; // villa에 이미 별명 있음(비-overwrite)
    let notFound = 0; // 매칭되는 villa 대화 없음(빈 대화 미이관 등)
    let empty = 0; // 별명이 공백
    let truncated = 0;
    const samples: string[] = [];

    for (const row of aliasRows) {
      let alias = (row.alias ?? "").trim();
      if (!alias) {
        empty += 1;
        continue;
      }
      if (alias.length > NICKNAME_MAX) {
        alias = alias.slice(0, NICKNAME_MAX);
        truncated += 1;
      }

      const conv = await prisma.zaloConversation.findFirst({
        where: { ownerAdminId, zaloUserId: row.userId },
        select: { id: true, nickname: true, displayName: true },
      });
      if (!conv) {
        notFound += 1;
        continue;
      }
      const current = conv.nickname?.trim() ?? "";
      if (current && !overwrite) {
        skippedExisting += 1;
        continue;
      }
      if (current === alias) {
        // 이미 동일 — 변경·감사 불필요(멱등).
        continue;
      }

      if (samples.length < 10) {
        samples.push(`  ${row.userId}: "${conv.nickname ?? conv.displayName ?? ""}" → "${alias}"`);
      }

      if (!dryRun) {
        await prisma.zaloConversation.update({
          where: { id: conv.id },
          data: { nickname: alias },
        });
        await writeAuditLog({
          action: "UPDATE",
          entity: "ZaloConversation",
          entityId: conv.id,
          userId: ownerAdminId,
          changes: { nickname: { old: conv.nickname, new: alias } },
        }).catch(() => {});
      }
      updated += 1;
    }

    console.log("\n변경 예정/완료 샘플(최대 10):");
    console.log(samples.length ? samples.join("\n") : "  (없음)");
    console.log(
      `\n${dryRun ? "[DRY-RUN] " : ""}별명 ${dryRun ? "이관 대상" : "이관 완료"}: ${updated}건` +
        ` / 기존 별명 보존(skip): ${skippedExisting}건` +
        ` / 매칭 대화 없음: ${notFound}건` +
        ` / 빈 별명: ${empty}건` +
        ` / 40자 초과 절단: ${truncated}건`
    );
    if (dryRun) console.log("DRY-RUN — UPDATE 미실행. 본실행하려면 --dry-run 없이 다시 실행.");
    if (skippedExisting > 0 && !overwrite) {
      console.log(`(villa에 이미 별명이 있어 보존된 ${skippedExisting}건은 --overwrite로 덮어쓸 수 있습니다.)`);
    }
  } finally {
    await nike.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error("SYNC_NIKE_ALIASES_ERROR:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
