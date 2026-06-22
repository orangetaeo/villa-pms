// 부분실패 번역(translatedText) 재번역 — 일회성 운영자 수동 실행 (계약: T-zalo-translate-robust)
//
//   npx tsx scripts/fix-broken-translations.ts --dry-run   # 대상 건수·샘플만(쓰기 0)
//   npx tsx scripts/fix-broken-translations.ts             # 본실행(translateText UPDATE)
//
// 배경: gemini-2.5-flash(thinkingBudget:0)가 번역을 중간에 멈추고 원문(베트남어)을 그대로 남기는
//       간헐 부분실패로, translatedText에 "제가 양 nhà sản xuất tất…"처럼 앞 몇 글자만 한국어이고
//       나머지가 원문(베트남어)인 행이 프로덕션에 남아 있다. 이를 강화된 translateText로 재번역한다.
//       (lib/gemini.ts translateText는 이제 부분실패 감지+재시도를 내장 — 재번역 1회로 대부분 복구.)
//
// 대상(보수적·false positive 최소):
//   - direction='INBOUND' AND msgType='text' (수신 텍스트만 — STT/사진 OCR/발신 제외)
//   - translatedText IS NOT NULL AND 길이 충분(짧은 단어 1~2개 고유명사/연락처 제외)
//   - translatedText에 한글이 거의 없음(한글 비율 < 0.35) AND 라틴(베트남어 포함) 글자 다수 잔류
//   - 대화 translateMode != 'OFF' (OFF 대화는 애초에 번역 안 함 — 제외)
//   1차 후보를 SQL로 좁히고(한글 적음+라틴 잔류 추정), JS의 isBrokenKoTranslation으로 최종 확정
//   → 고유명사·브랜드(Hoka)·연락처(@handle)만 라틴인 정상 번역은 통과.
//
// 멱등: 재실행 시 이미 정상화된 행은 isBrokenKoTranslation 통과 → 다시 후보가 아님(중복 변경 0).
//       원문(ZaloMessage.text)을 다시 번역하므로 깨진 translatedText를 누적 가공하지 않는다.
// 동시성: 직렬(순차) 처리로 Gemini rate limit 보호 + 호출 간 짧은 간격.
// 보안: DATABASE_URL/GEMINI 키 로그 미출력. 샘플 출력은 원문/번역 일부만(개인정보 주의 — 최소 노출).
// 의존성: @prisma/client(lib/prisma — .env 자동 로드, GEMINI_API_KEY 포함) + lib/gemini. 신규 deps 0.

import { prisma } from "@/lib/prisma";
import { translateText, isBrokenKoTranslation, hangulRatio } from "@/lib/gemini";

/** 후보 1차 필터(SQL 보강용) — translatedText 최소 길이(고유명사 1~2단어 단독 제외). */
const MIN_LEN = 12;
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
 * 1차 후보 조회 — SQL로 거칠게 좁힌다(한글 거의 없음 추정):
 *  - INBOUND·text·translateMode!=OFF·translatedText 충분 길이
 *  - translatedText에 한글이 1글자도 없거나 매우 적은 행을 우선(정밀 판정은 JS).
 * SQL 정규식으로 "한글 포함 여부"만 거르고, 한글 비율 정밀 판정은 JS isBrokenKoTranslation에 맡긴다
 * (PostgreSQL에서 유니코드 비율 계산은 복잡 → 후보를 넉넉히 가져와 JS에서 확정).
 */
async function fetchCandidates(): Promise<CandidateRow[]> {
  return prisma.$queryRawUnsafe<CandidateRow[]>(
    `SELECT m."id", m."text", m."translatedText"
       FROM "ZaloMessage" m
       JOIN "ZaloConversation" c ON c."id" = m."conversationId"
      WHERE m."direction" = 'INBOUND'
        AND m."msgType" = 'text'
        AND m."translatedText" IS NOT NULL
        AND char_length(BTRIM(m."translatedText")) >= ${MIN_LEN}
        AND c."translateMode" <> 'OFF'
        -- 라틴(베트남어 포함) 글자가 다수 잔류하는 행만(원문 잔류 추정). 한글 비율 정밀판정은 JS.
        AND m."translatedText" ~ '[A-Za-zÀ-ỹ].*[A-Za-zÀ-ỹ].*[A-Za-zÀ-ỹ]'
      ORDER BY m."createdAt" DESC;`
  );
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`=== 부분실패 번역 재번역 ${dryRun ? "(DRY-RUN — 쓰기 0)" : "(본실행)"} ===`);

  const candidates = await fetchCandidates();
  // JS 정밀 판정 — isBrokenKoTranslation으로 false positive 최종 제거.
  //   원문(text) 기준으로 판정. text 없으면 translatedText 자체 한글 비율로 보수 판정.
  const broken = candidates.filter((r) => {
    const src = (r.text ?? "").trim();
    if (src.length > 0) return isBrokenKoTranslation(src, r.translatedText);
    // 원문이 없으면(이론상 드묾) translatedText 한글 비율로만 판단.
    return hangulRatio(r.translatedText) < 0.35;
  });

  console.log(`1차 후보(SQL): ${candidates.length}건 → 부분실패 확정(JS): ${broken.length}건`);

  // 샘플 출력(최대 5건) — 원문/깨진번역 앞부분만(개인정보 최소 노출).
  const SAMPLE = 5;
  for (const r of broken.slice(0, SAMPLE)) {
    const src = (r.text ?? "").slice(0, 40);
    const bad = r.translatedText.slice(0, 40);
    console.log(`  [${r.id}] 원문="${src}…" / 현재번역="${bad}…" (한글비율 ${hangulRatio(r.translatedText).toFixed(2)})`);
  }

  if (dryRun) {
    console.log("DRY-RUN — UPDATE 미실행. 본실행하려면 --dry-run 없이 다시 실행.");
    return;
  }

  if (broken.length === 0) {
    console.log("재번역 대상 0건 — 변경 없음(멱등).");
    return;
  }

  // 본실행 — 직렬 재번역(원문 text를 ko로 다시 번역). text 없으면 스킵.
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of broken) {
    const src = (r.text ?? "").trim();
    if (src.length === 0) {
      skipped += 1;
      continue;
    }
    try {
      const fixed = await translateText(src, "ko"); // 강화 translateText(감지+재시도 내장)
      // 결과가 여전히 부분실패면 덮어쓰지 않음(누적 악화 방지 — 기존 값 보존).
      if (!fixed || fixed.trim().length === 0 || isBrokenKoTranslation(src, fixed)) {
        failed += 1;
        continue;
      }
      await prisma.zaloMessage.update({
        where: { id: r.id },
        data: { translatedText: fixed },
      });
      ok += 1;
    } catch (e) {
      // 본문 에코 방지 — 상태/메시지만.
      console.error(`  재번역 실패 [${r.id}]:`, e instanceof Error ? e.message : String(e));
      failed += 1;
    }
    await new Promise((res) => setTimeout(res, THROTTLE_MS));
  }

  console.log(`재번역 완료: 성공 ${ok}건 / 스킵(원문없음) ${skipped}건 / 실패·미개선 ${failed}건`);
}

main()
  .catch((e) => {
    console.error("FIX_BROKEN_TRANSLATIONS_ERROR:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
