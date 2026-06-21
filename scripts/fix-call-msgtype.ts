// 통화 텍스트 msgType 일괄 보정 — 일회성 운영자 수동 실행 (계약: villa Zalo 통화 아이콘 표시)
//
//   npx tsx scripts/fix-call-msgtype.ts --dry-run   # 건수만 확인(쓰기 0)
//   npx tsx scripts/fix-call-msgtype.ts             # 본실행(UPDATE)
//
// 배경: zca-js/Zalo는 통화 기록을 별도 msgType 없이 본문 text="Cuộc gọi"(베트남어 "통화")로 보낸다.
//       그래서 villa DB에 msgType="text", text="Cuộc gọi…"로 저장된 통화가 다수 존재한다(INBOUND·OUTBOUND).
//       ETL(과거 이관)·통합 후 실시간 수신 양쪽에 섞여 있다. 이를 msgType="call"로 보정해
//       chat-pane이 통화 아이콘+라벨로 렌더하도록 한다.
//
// 대상(보수적·안전): msgType='text' AND text의 trim 전체가 알려진 Zalo 통화 라벨인 ZaloMessage.
//   - lib/zalo-inbound.ts isCallSystemText와 동일 의미: 열린 prefix 매칭(`^Cuộc gọi`)이 아니라
//     **알려진 통화 라벨 정확(trim 전체) 매칭**(앵커 ^…$). 우연히 "Cuộc gọi"로 시작하는 일반
//     대화("Cuộc gọi 잘 받았어요")는 제외 → 오판 0.
//   - PostgreSQL 정규식 `~*`(대소문자 무시), BTRIM으로 선두/후미 공백 제거 후 매칭.
//   - text는 **유지**(call 카드는 text를 무시하므로 무해 + 데이터 보존). msgType만 변경.
// 멱등: 이미 msgType='call'인 행은 WHERE에서 제외되어 재실행해도 0건(중복 변경 없음).
// 스코프: ownerAdminId 불필요 — ZaloMessage는 이미 테오(단일 운영자) 대화만 저장됨(ADR-0007).
//
// 보안: DATABASE_URL 값 로그 미출력. 본문(text) 샘플도 통화 시스템 텍스트뿐(개인정보 무관).
// 의존성: @prisma/client(lib/prisma) — 신규 deps 0.

import { prisma } from "@/lib/prisma";

// lib/zalo-inbound.ts isCallSystemText의 알려진 라벨 정확 매칭과 동일 의미(SQL 앵커 정규식으로 표현).
//   ~*  : 대소문자 무시 정규식 일치(POSIX). ^…$ : trim 전체가 라벨과 정확히 일치할 때만(prefix 매칭 아님).
//   베트남어 변형(nhỡ/đi/đến/thoại/video/bị nhỡ/không thành công)을 선택지로 열거. 실데이터는 베트남어뿐.
const CALL_TEXT_REGEX =
  "^cuộc gọi( nhỡ| đi| đến| thoại| video| bị nhỡ| không thành công)?$";

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`=== 통화 msgType 보정 ${dryRun ? "(DRY-RUN — 쓰기 0)" : "(본실행)"} ===`);

  // 1) 대상 건수 집계 (msgType='text' AND trim(text) ~* '^Cuộc gọi')
  const countRows = await prisma.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*)::int AS c
       FROM "ZaloMessage"
      WHERE "msgType" = 'text'
        AND "text" IS NOT NULL
        AND BTRIM("text") ~* $1;`,
    CALL_TEXT_REGEX
  );
  const target = countRows[0]?.c ?? 0;

  // 방향(INBOUND/OUTBOUND)별 분포도 함께 출력(검증용).
  const dist = await prisma.$queryRawUnsafe<{ direction: string; c: number }[]>(
    `SELECT "direction", COUNT(*)::int AS c
       FROM "ZaloMessage"
      WHERE "msgType" = 'text'
        AND "text" IS NOT NULL
        AND BTRIM("text") ~* $1
      GROUP BY "direction" ORDER BY 1;`,
    CALL_TEXT_REGEX
  );

  console.log(`보정 대상(msgType='text' AND text ~ '^Cuộc gọi'): ${target}건`);
  for (const row of dist) {
    console.log(`  - ${row.direction}: ${row.c}건`);
  }

  if (dryRun) {
    console.log("DRY-RUN — UPDATE 미실행. 본실행하려면 --dry-run 없이 다시 실행.");
    return;
  }

  if (target === 0) {
    console.log("보정 대상 0건 — 변경 없음(멱등).");
    return;
  }

  // 2) 본실행 — msgType만 'call'로 UPDATE(text 유지). 이미 'call'인 행은 WHERE에서 제외(멱등).
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "ZaloMessage"
        SET "msgType" = 'call'
      WHERE "msgType" = 'text'
        AND "text" IS NOT NULL
        AND BTRIM("text") ~* $1;`,
    CALL_TEXT_REGEX
  );
  console.log(`UPDATE 완료: ${updated}건 → msgType='call' (text 보존)`);
}

main()
  .catch((e) => {
    console.error("FIX_CALL_MSGTYPE_ERROR:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
