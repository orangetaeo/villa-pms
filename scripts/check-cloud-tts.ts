// scripts/check-cloud-tts.ts — Cloud TTS(Chirp 3: HD 한국어) 연결 점검
//
// 실행: node --env-file=.env --import tsx scripts/check-cloud-tts.ts [목소리]
//
// GCP 콘솔에서 ① Cloud Text-to-Speech API 사용 설정 ② API 키 제한에 texttospeech 추가를
// 마친 뒤 이 스크립트로 확인한다. 성공하면 tmp/cloud-tts-<목소리>.wav 로 샘플을 남기므로
// **실제로 들어보고** 목소리를 고를 수 있다(문서로는 못 고른다 — 계약 C 항목의 교훈).
import { promises as fs } from "fs";
import path from "path";
import { synthesizeWithGoogle, toChirpVoiceName, parseWavDuration } from "@/lib/google-tts";

const SAMPLE =
  "여기가 푸꾸옥 소나시아에 있는 풀빌라인데요, 방이 세 개고 수영장은 우리 가족만 써요. 문 열고 나가면 바로 앞이 해변이라, 아침에 눈뜨자마자 바다부터 보게 되더라고요.";

async function main() {
  const voice = process.argv[2] ?? process.env.GEMINI_TTS_VOICE ?? "Kore";
  console.log(`목소리: ${voice} → ${toChirpVoiceName(voice)}`);

  try {
    const r = await synthesizeWithGoogle(SAMPLE, voice);
    const dir = path.join(process.cwd(), "tmp");
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, `cloud-tts-${voice}.wav`);
    await fs.writeFile(out, r.wav);
    console.log(`✅ 성공 — ${r.durationSec.toFixed(2)}초 · ${(r.wav.length / 1024).toFixed(0)}KB`);
    console.log(`   헤더 파싱 길이: ${parseWavDuration(r.wav)?.toFixed(2)}초`);
    console.log(`   저장: ${out}`);
    console.log(`\n비용: ${SAMPLE.length}자 · Chirp 3: HD는 월 100만 자 무료 → 0원`);
  } catch (e) {
    console.error(`❌ 실패: ${(e as Error).message}`);
    console.error(`\n403이면 GCP 콘솔에서 두 가지를 확인하세요(프로젝트 1003158095558):`);
    console.error(`  1) API 및 서비스 → 라이브러리 → "Cloud Text-to-Speech API" 사용 설정`);
    console.error(`  2) 사용자 인증 정보 → 해당 API 키 → API 제한사항에 Cloud Text-to-Speech API 추가`);
    process.exit(1);
  }
}

main();
