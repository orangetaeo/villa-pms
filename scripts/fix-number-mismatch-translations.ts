// 숫자 오역 번역(translatedText) 재번역 — 일회성 운영자 수동 실행
//
//   npx tsx scripts/fix-number-mismatch-translations.ts --dry-run   # 대상 건수·샘플만(쓰기 0)
//   npx tsx scripts/fix-number-mismatch-translations.ts             # 본실행(translateText UPDATE)
//
// 배경: 채팅 번역 프롬프트에 "숫자·금액 원형 유지" 지시가 없어, Gemini가 금액 숫자를 임의 변경하는
//       오류가 관측됨(실제: 원문 "ứng 1,700,000" → 번역 "1,770,000원" 가불). 금액·전화가 걸린
//       위험한 오역이라 과거 누적분을 점검·교정한다. lib/gemini.ts translateText는 이제 프롬프트 강화 +
//       numbersPreserved 가드(숫자 누락 시 재시도)를 내장 — 재번역 1회로 대부분 복구.
//
// 대상(보수적·발송이력 보존):
//   - direction='INBOUND' AND msgType='text' (수신 텍스트만 — 수신 ko 번역은 재도출이 정당)
//     · OUTBOUND는 translatedText가 "실제 발송된 번역문" 기록이므로 덮어쓰면 발송 이력 왜곡 → 제외.
//   - translatedText IS NOT NULL AND 대화 translateMode != 'OFF'
//   - 원문(text)에 숫자가 있는 행만 1차로 좁히고(SQL), numbersPreserved로 최종 확정(JS):
//     원문의 큰 숫자(3자리↑)가 번역문에 그대로 없으면 = 숫자 오역 의심.
//
// 멱등: 재실행 시 이미 교정된 행은 numbersPreserved 통과 → 다시 후보 아님(중복 변경 0).
//       원문(text)을 다시 번역하므로 깨진 translatedText를 누적 가공하지 않는다.
// 동시성: 직렬(순차) 처리 + 호출 간 간격으로 Gemini rate limit 보호.
// 보안: DATABASE_URL/GEMINI 키 로그 미출력. 샘플 출력은 원문/번역 일부만(개인정보 최소 노출).
// 의존성: @prisma/client(lib/prisma — .env 자동 로드) + lib/gemini. 신규 deps 0.

import { prisma } from "@/lib/prisma";
import { translateText, numbersPreserved, isBrokenKoTranslation } from "@/lib/gemini";

/** 호출 간 간격(ms) — Gemini rate limit·과금 폭주 방지(직렬 처리). */
const THROTTLE_MS = 400;

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes("--dry-run") };
}

interface CandidateRow {
  id: string;
  text: string | null;
  translatedText: string;
}

/**
 * 1차 후보 조회(SQL로 거칠게) — INBOUND·text·translateMode!=OFF·translatedText 존재 + 원문에 숫자 포함.
 * 숫자 보존 정밀 판정(천단위 구분자 정규화 등)은 JS numbersPreserved에 맡긴다.
 */
async function fetchCandidates(): Promise<CandidateRow[]> {
  return prisma.$queryRawUnsafe<CandidateRow[]>(
    `SELECT m."id", m."text", m."translatedText"
       FROM "ZaloMessage" m
       JOIN "ZaloConversation" c ON c."id" = m."conversationId"
      WHERE m."direction" = 'INBOUND'
        AND m."msgType" = 'text'
        AND m."translatedText" IS NOT NULL
        AND c."translateMode" <> 'OFF'
        AND m."text" ~ '[0-9]'
      ORDER BY m."createdAt" DESC;`
  );
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`=== 숫자 오역 번역 재번역 ${dryRun ? "(DRY-RUN — 쓰기 0)" : "(본실행)"} ===`);

  const candidates = await fetchCandidates();
  // JS 정밀 판정 — 원문의 큰 숫자가 번역문에 보존됐는지. 보존 실패 = 숫자 오역 후보.
  const mismatched = candidates.filter((r) => {
    const src = (r.text ?? "").trim();
    if (src.length === 0) return false;
    return !numbersPreserved(src, r.translatedText);
  });

  console.log(`1차 후보(SQL·숫자 포함): ${candidates.length}건 → 숫자 오역 확정(JS): ${mismatched.length}건`);

  // 샘플 출력(최대 8건) — 원문/현재번역 앞부분만(개인정보 최소 노출).
  const SAMPLE = 8;
  for (const r of mismatched.slice(0, SAMPLE)) {
    const src = (r.text ?? "").slice(0, 50);
    const bad = r.translatedText.slice(0, 50);
    console.log(`  [${r.id}] 원문="${src}…" / 현재번역="${bad}…"`);
  }

  if (dryRun) {
    console.log("DRY-RUN — UPDATE 미실행. 본실행하려면 --dry-run 없이 다시 실행.");
    return;
  }

  if (mismatched.length === 0) {
    console.log("재번역 대상 0건 — 변경 없음(멱등).");
    return;
  }

  // 본실행 — 직렬 재번역(원문 text를 ko로 다시 번역).
  let ok = 0;
  let failed = 0;
  for (const r of mismatched) {
    const src = (r.text ?? "").trim();
    if (src.length === 0) {
      failed += 1;
      continue;
    }
    try {
      const fixed = await translateText(src, "ko"); // 강화 translateText(숫자 가드+재시도 내장)
      // 결과가 비었거나, 여전히 숫자 불일치/부분실패면 덮어쓰지 않음(누적 악화 방지 — 기존 값 보존).
      if (
        !fixed ||
        fixed.trim().length === 0 ||
        !numbersPreserved(src, fixed) ||
        isBrokenKoTranslation(src, fixed)
      ) {
        failed += 1;
        continue;
      }
      await prisma.zaloMessage.update({
        where: { id: r.id },
        data: { translatedText: fixed },
      });
      ok += 1;
    } catch (e) {
      console.error(`  재번역 실패 [${r.id}]:`, e instanceof Error ? e.message : String(e));
      failed += 1;
    }
    await new Promise((res) => setTimeout(res, THROTTLE_MS));
  }

  console.log(`재번역 완료: 성공 ${ok}건 / 실패·미개선 ${failed}건`);
}

main()
  .catch((e) => {
    console.error("FIX_NUMBER_MISMATCH_ERROR:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
