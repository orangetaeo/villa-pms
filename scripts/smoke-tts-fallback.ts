// scripts/smoke-tts-fallback.ts — 엔진 전환·폴백 실동작 확인(일회성 스모크)
// 실행: node --env-file=.env --import tsx scripts/smoke-tts-fallback.ts
//
// 확인 항목:
//   ① TTS_PROVIDER=google인데 Cloud TTS가 막혀 있으면 → Gemini로 폴백하고 로그를 남기는가
//   ② 폴백 결과가 **gemini 캐시 키**에 저장되는가(google 키에 저장하면 콘솔 조치 후에도 옛 음성이 나온다)
//   ③ 길이(durationSec)가 정상인가 — 컷 길이 역산의 입력이라 0이면 영상이 깨진다
import { synthesizeSpeech, ttsCacheKey, ttsConfig } from "@/lib/gemini-tts";

async function main() {
  console.log("설정:", ttsConfig());

  // 캐시 미스를 보장하려고 매번 다른 문장을 쓴다(시각 삽입은 하지 않고 인자로 받는다)
  const salt = process.argv[2] ?? "가";
  const text = `여기가 푸꾸옥 소나시아에 있는 풀빌라인데요, 방이 세 개고 수영장은 우리 가족만 써요${salt}`;

  const r = await synthesizeSpeech(text);
  console.log(`요청 엔진 google → 실제 사용: ${r.provider} / 모델 ${r.model} / 목소리 ${r.voice}`);
  console.log(`길이 ${r.durationSec.toFixed(2)}초 · ${(r.wav.length / 1024).toFixed(0)}KB · 캐시히트 ${r.cached}`);

  if (r.durationSec <= 0) throw new Error("길이가 0 — 컷 길이 역산이 깨진다");

  const googleKey = ttsCacheKey(text, r.voice, undefined, "google");
  const geminiKey = ttsCacheKey(text, r.voice, undefined, "gemini");
  console.log(`캐시 키 google=${googleKey.slice(0, 12)}… gemini=${geminiKey.slice(0, 12)}…`);
  if (googleKey === geminiKey) throw new Error("엔진이 캐시 키에 안 들어갔다 — 교차 히트 위험");

  // 같은 문장 재요청 → 폴백이 gemini 키에 저장됐다면, google 요청은 여전히 미스가 나고
  // gemini 요청은 히트해야 한다.
  const again = await synthesizeSpeech(text, { provider: "gemini" });
  console.log(`gemini 키 재조회 캐시히트: ${again.cached} (true여야 정상)`);
  if (!again.cached) throw new Error("폴백 결과가 gemini 키에 저장되지 않았다");

  console.log("\n✅ 폴백·캐시 분리 정상");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
