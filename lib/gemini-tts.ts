// lib/gemini-tts.ts — 한국어 나레이션 음성 합성 파사드 + R2 캐시 (villa-clip-narration-p2)
//
// ★ 2026-07-23부터 이 파일은 **엔진 두 개의 파사드**다(파일명은 호출부 churn을 피해 유지):
//     기본  Google Cloud TTS Chirp 3: HD 한국어 (lib/google-tts.ts) — 로케일 전용 모델, 월 100만 자 무료
//     폴백  Gemini TTS (아래 callGeminiTts)                          — 영어 기준 다국어 음성, 편당 약 $0.012
//   `TTS_PROVIDER=gemini`로 예전 동작 복귀 가능.
//
// 왜 필요한가: 쇼츠·릴스에 음악 대신 나레이션을 넣는다(테오 확정). BGM이 유일한 Content ID
//   리스크였는데 합성 음성은 그 위험이 0이고, 말이 있는 영상이 쇼츠 체류시간에 유리하다.
//
// API: models/{model}:generateContent + responseModalities:["AUDIO"].
//   응답은 inlineData.data(base64) = **PCM 24kHz / 16bit / mono (raw, 헤더 없음)**.
//   → 44바이트 WAV 헤더를 붙여 반환한다. ffmpeg/ffprobe 입력을 한 종류로 통일하기 위함
//     (raw s16le는 입력마다 -f/-ar/-ac 플래그가 필요해 filter_complex 조립이 지저분해진다).
//
// ★ 모델 핀: preview 모델이라 수명주기가 짧다 — GEMINI_TTS_MODEL 환경변수로 코드 무변경 교체.
//   (gemini-2.0-flash 퇴역 사고 대비책인 기존 GEMINI_MODEL 핀 패턴을 그대로 복제)
// ★ 목소리: 30종 중 무엇이 한국어에 자연스러운지는 **들어봐야 안다** — GEMINI_TTS_VOICE로 교체 가능.
// ★ 캐시: 같은 (문장·목소리·모델)은 재합성하지 않는다. 운영자가 대본 4줄 중 1줄만 고치면
//   나머지 3줄은 캐시 히트 → 재렌더가 빠르고 저렴하다(계약 C7).
import { createHash } from "crypto";
import { readTtsAudio, saveTtsAudio } from "@/lib/storage";
import { GeminiNotConfiguredError } from "@/lib/gemini";
import { synthesizeWithGoogle, parseWavDuration, GOOGLE_TTS_MODEL, GOOGLE_TTS_LANGUAGE } from "@/lib/google-tts";

const TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";
const TTS_VOICE = process.env.GEMINI_TTS_VOICE ?? "Kore";

/**
 * 합성 엔진 (2026-07-23 추가).
 *   "google" = Google Cloud TTS Chirp 3: HD 한국어 — **기본값**. 로케일 전용 모델이라 한국어가
 *              자연스럽고, 월 100만 자 무료라 우리 사용량(편당 370자)에선 사실상 0원이다.
 *   "gemini" = 기존 Gemini TTS. 영어 기준 다국어 음성이라 한국어 억양이 겉돈다.
 *
 * ★ google이 실패하면 **자동으로 gemini로 폴백**한다. Cloud TTS는 GCP 콘솔에서 API 사용 설정과
 *   API 키 제한 해제가 선행돼야 하는데(현재 API_KEY_SERVICE_BLOCKED), 그 조치 전에 배포되더라도
 *   나레이션이 끊기면 안 된다. 폴백은 조용히 넘어가지 않고 console.error로 남긴다 —
 *   "바꿨는데 사실은 계속 예전 엔진이었다"가 로그 없이 묻히는 게 최악이다.
 */
export type TtsProvider = "google" | "gemini";
const TTS_PROVIDER: TtsProvider = process.env.TTS_PROVIDER === "gemini" ? "gemini" : "google";
const TTS_TIMEOUT_MS = 60_000; // 음성 합성은 텍스트 생성보다 느리다

/** Gemini TTS 출력 규격 — 문서 고정값(PCM 24kHz 16bit mono). WAV 헤더·길이 계산에 사용. */
export const TTS_SAMPLE_RATE = 24_000;
export const TTS_BITS_PER_SAMPLE = 16;
export const TTS_CHANNELS = 1;

/**
 * 톤 지시 — Gemini TTS는 자연어로 말투·속도를 지시할 수 있다.
 *
 * ★ 속도(2026-07-22 테오 피드백): 초기 "조금 느리고 또렷하게"는 **실제로 너무 느렸다**.
 *   쇼츠는 첫 몇 초에 이탈이 갈리는 포맷이라 늘어지는 낭독은 치명적이다.
 *   → "약간 빠르게, 경쾌하게"로 교정. 더 조정이 필요하면 GEMINI_TTS_STYLE로 코드 수정 없이 바꾼다.
 */
const STYLE_PROMPT =
  process.env.GEMINI_TTS_STYLE ??
  "다음 문장을 밝고 경쾌한 여행 소개 톤으로, 보통보다 약간 빠르게 자연스럽게 읽어줘. 또박또박 끊어 읽지 말고 자연스러운 구어체 속도로. 문장만 읽고 다른 말은 하지 마.";

interface TtsResponse {
  candidates?: {
    content?: {
      parts?: { inlineData?: { data?: string; mimeType?: string } }[];
    };
  }[];
}

/** raw PCM(s16le mono) → WAV(RIFF) 버퍼. 44바이트 표준 헤더. */
export function pcmToWav(
  pcm: Buffer,
  sampleRate = TTS_SAMPLE_RATE,
  channels = TTS_CHANNELS,
  bitsPerSample = TTS_BITS_PER_SAMPLE
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4); // 파일 크기 − 8
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt 청크 크기
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * WAV 버퍼의 재생 길이(초). ffprobe를 띄우지 않고 데이터 청크 크기로 직접 계산한다
 * (문장마다 프로세스를 spawn하면 문장 수만큼 수백ms가 낭비된다).
 */
export function wavDurationSec(
  wav: Buffer,
  sampleRate = TTS_SAMPLE_RATE,
  channels = TTS_CHANNELS,
  bitsPerSample = TTS_BITS_PER_SAMPLE
): number {
  const dataBytes = Math.max(0, wav.length - 44);
  const bytesPerSec = (sampleRate * channels * bitsPerSample) / 8;
  return bytesPerSec > 0 ? dataBytes / bytesPerSec : 0;
}

/**
 * 캐시 키 — 같은 (엔진·문장·목소리·모델)은 한 번만 합성한다.
 * ★ 엔진을 키에 넣어야 한다: 안 넣으면 Chirp 3: HD로 갈아탄 뒤에도 예전 Gemini 음성이
 *   캐시에서 그대로 나와 "바꿨는데 소리가 똑같다"가 된다. 목소리 이름(Kore 등)을
 *   두 엔진이 공유하므로 더더욱 구분자가 필요하다.
 */
export function ttsCacheKey(
  text: string,
  voice = TTS_VOICE,
  model = TTS_MODEL,
  provider: TtsProvider = TTS_PROVIDER
): string {
  return createHash("sha256").update(`${provider}\u0000${model}\u0000${voice}\u0000${text}`).digest("hex");
}

export interface TtsResult {
  wav: Buffer;
  durationSec: number;
  /** true면 R2 캐시에서 가져옴(API 미호출) */
  cached: boolean;
  voice: string;
  model: string;
  /** 실제로 합성에 쓰인 엔진 — 폴백이 일어나면 요청한 것과 다를 수 있다 */
  provider?: TtsProvider;
}

/**
 * 쉼 태그(`[pause]`) 제거 — Chirp 3: HD **전용** 마크업이라 Gemini TTS는 그대로 읽어 버린다.
 * ★ 폴백 경로에서 이걸 빠뜨리면 나레이션이 "…있고, 포즈, 샤워부스와…"가 된다.
 *   태그 자리에 공백 하나만 남긴다(쉼은 사라지지만 문장은 온전하다).
 */
export function stripPauseTags(text: string): string {
  return text.replace(/\s*\[pause[^\]]*\]\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
}

/** Gemini TTS API 1회 호출 — 캐시 미스일 때만 호출된다. */
async function callGeminiTts(
  rawText: string,
  voice: string,
  fetchFn: typeof fetch
): Promise<Buffer> {
  const text = stripPauseTags(rawText);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();

  const res = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${STYLE_PROMPT}\n\n${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    // 본문에 프롬프트가 에코될 수 있으므로 상태 코드만 남긴다(gemini.ts 규약 동일)
    throw new Error(`Gemini TTS HTTP ${res.status}`);
  }

  const data = (await res.json()) as TtsResponse;
  const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
    ?.data;
  if (!b64) throw new Error("Gemini TTS 응답에 오디오가 없습니다");

  const pcm = Buffer.from(b64, "base64");
  if (pcm.length === 0) throw new Error("Gemini TTS 오디오가 비어 있습니다");
  return pcmToWav(pcm);
}

/**
 * WAV 길이(초) — 헤더를 실제로 파싱하고, 실패하면 Gemini 규격(24kHz·mono·16bit·44B 헤더)으로 폴백.
 * ★ 엔진마다 헤더가 다를 수 있어 상수 계산만 쓰면 안 된다. 길이가 틀리면 컷 길이 역산이
 *   통째로 어긋나 화면과 말이 안 맞는다(narration.ts computeNarrationTimeline).
 */
function durationOf(wav: Buffer): number {
  return parseWavDuration(wav) ?? wavDurationSec(wav);
}

/**
 * 문장 1개 → 한국어 나레이션 WAV. R2 캐시 우선.
 *
 * 엔진 선택: 기본 Chirp 3: HD(google) → 실패 시 Gemini TTS로 폴백.
 * @throws GeminiNotConfiguredError 키 미설정 / Error 두 엔진 모두 실패
 */
export async function synthesizeSpeech(
  text: string,
  opts: { voice?: string; fetchFn?: typeof fetch; provider?: TtsProvider } = {}
): Promise<TtsResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("TTS 대상 문장이 비어 있습니다");

  const voice = opts.voice ?? TTS_VOICE;
  const fetchFn = opts.fetchFn ?? fetch;
  const wanted = opts.provider ?? TTS_PROVIDER;

  // ① 캐시 조회 — 원하는 엔진의 키로만 본다(엔진이 키에 포함되므로 교차 히트 없음).
  //    R2·디스크 양쪽 지원(readTtsAudio). 실패는 미스로 수렴.
  const key = `tts/${ttsCacheKey(trimmed, voice, TTS_MODEL, wanted)}.wav`;
  const cachedWav = await readTtsAudio(key);
  if (cachedWav && cachedWav.length > 44) {
    return { wav: cachedWav, durationSec: durationOf(cachedWav), cached: true, voice, model: modelLabel(wanted), provider: wanted };
  }

  // ② 합성 — google 우선, 실패하면 gemini로 폴백(나레이션이 아예 빠지는 것보다 낫다).
  let used: TtsProvider = wanted;
  let wav: Buffer;
  if (wanted === "google") {
    try {
      wav = (await synthesizeWithGoogle(trimmed, voice, fetchFn)).wav;
    } catch (e) {
      // 조용히 넘어가면 "엔진을 바꿨는데 소리가 그대로"인 상태를 아무도 모른다 — 반드시 남긴다.
      console.error(`[tts] Chirp 3: HD 실패 → Gemini TTS로 폴백합니다: ${(e as Error).message}`);
      used = "gemini";
      wav = await callGeminiTts(trimmed, voice, fetchFn);
    }
  } else {
    wav = await callGeminiTts(trimmed, voice, fetchFn);
  }

  // ③ 캐시 저장 — **실제 사용된 엔진의 키**로 저장한다. 폴백 결과를 google 키에 저장하면
  //    콘솔 조치가 끝난 뒤에도 예전 음성이 계속 나온다.
  try {
    await saveTtsAudio(wav, `tts/${ttsCacheKey(trimmed, voice, TTS_MODEL, used)}.wav`);
  } catch {
    // 캐시 저장 실패가 렌더를 막아선 안 된다
  }

  return { wav, durationSec: durationOf(wav), cached: false, voice, model: modelLabel(used), provider: used };
}

function modelLabel(p: TtsProvider): string {
  return p === "google" ? `${GOOGLE_TTS_LANGUAGE}-${GOOGLE_TTS_MODEL}` : TTS_MODEL;
}

/** 현재 핀된 엔진·모델·목소리 — 운영자 화면 표시·감사 로그용. */
export function ttsConfig(): { model: string; voice: string; provider: TtsProvider } {
  return { model: modelLabel(TTS_PROVIDER), voice: TTS_VOICE, provider: TTS_PROVIDER };
}
