// lib/google-tts.ts — Google Cloud Text-to-Speech (Chirp 3: HD 한국어) 나레이션 합성
//
// 왜 갈아타나(테오 2026-07-23): Gemini TTS 프리빌트 목소리는 **영어 기준으로 만든 다국어 음성**이라
//   한국어 억양이 미묘하게 겉돈다("아직도 AI 느낌이 강하다"). Chirp 3: HD는 로케일별 모델이라
//   한국어가 훨씬 자연스럽다. 게다가 **비용이 내려간다**:
//     - Gemini TTS  = 오디오 출력 $10/1M 토큰(25 토큰/초) → 48초 나레이션 편당 약 $0.012
//     - Chirp 3: HD = $30/1M **자**, 그런데 **월 100만 자 무료**. 우리 대본은 편당 370자라
//       월 100편을 만들어도 3.7만 자 → 사실상 0원.
//
// ★ 목소리 이름은 Gemini와 같은 로스터를 쓴다(Kore·Leda·Sulafat·Achird…). 다만 형식이 다르다:
//     Gemini      "Kore"
//     Chirp 3: HD "ko-KR-Chirp3-HD-Kore"
//   그래서 GEMINI_TTS_VOICE 값을 그대로 재사용할 수 있게 짧은 이름 → 정식 이름으로 확장한다.
//
// ★ **톤 지시문을 텍스트 앞에 붙이면 안 된다.** Gemini TTS는 자연어 지시를 이해하지만
//   Chirp 3: HD에는 style/prompt 필드가 없어서 지시문을 **그대로 소리내어 읽는다**.
//   속도 조절은 audioConfig.speakingRate로 한다(그게 이 모델의 대응 레버).
//
// ★ 출력은 LINEAR16 24kHz mono로 요청한다 — Gemini TTS 경로와 같은 규격이라
//   ffmpeg 입력·타임라인 계산(narration.ts)이 분기 없이 그대로 동작한다.
import { GeminiNotConfiguredError } from "@/lib/gemini";

/**
 * 절(節) 사이에 넣는 쉼 태그. Chirp 3: HD는 `input.markup`으로 **명시적 쉼**을 받는다.
 *
 * ★ 왜 필요한가(테오 2026-07-23): "…안방이 있고, [쉼 없이] 샤워부스와 욕조를 갖춘…" 처럼
 *   절이 바뀌는데 숨을 안 쉬어서 두 문장이 뭉개져 들린다는 지적이 반복됐다. 모델의 자연 쉼은
 *   실측 0.33초로 들쭉날쭉하지만, 이 태그를 넣으면 그 자리에 **0.69초 무음**이 확정적으로 생긴다
 *   (silencedetect로 확인). 프롬프트로 부탁할 수 없는 종류라 마크업으로 못박는다.
 * ★ Gemini TTS 폴백 경로는 이 태그를 **소리 내어 읽는다** — 그쪽 호출 전에 반드시 제거한다
 *   (lib/gemini-tts.ts stripPauseTags).
 */
export const TTS_PAUSE_TAG = "[pause]";
/**
 * 태그 하나가 만드는 무음 길이(초) — 타임라인이 이 값만큼을 발화에서 빼고 그 절에 준다.
 * ★ 실측 범위 0.50~0.81초(문장·위치마다 다르다). 중간값을 쓴다 — 이 값은 컷이 화면에
 *   머무는 시간 추정에만 쓰이고, 최종 자막·오디오 정렬은 실측 세그먼트 길이로 다시 맞춰진다
 *   (retimeNarrationTimeline). 그래서 소수점 오차가 화면·말 어긋남으로 번지지 않는다.
 */
export const TTS_PAUSE_SEC = 0.6;
/** 텍스트에 쉼 태그가 들어 있나 — 있으면 text가 아니라 markup으로 보내야 한다. */
export function hasPauseTag(text: string): boolean {
  return text.includes(TTS_PAUSE_TAG);
}

/** Chirp 3: HD 기본 목소리(짧은 이름). GEMINI_TTS_VOICE와 로스터를 공유한다. */
export const GOOGLE_TTS_MODEL = "Chirp3-HD";
export const GOOGLE_TTS_LANGUAGE = process.env.GOOGLE_TTS_LANGUAGE ?? "ko-KR";

/**
 * 발화 속도. Chirp 3: HD엔 톤 지시문이 없으므로 이게 유일한 속도 레버다.
 * 1.0 = 기본. 예전 Gemini 스타일 프롬프트의 "약간 빠르게"가 오히려 광고 성우처럼 들려
 * AI 느낌의 원인 중 하나였으므로(테오 2026-07-23) 기본은 자연 속도로 둔다.
 */
const SPEAKING_RATE = Number(process.env.GOOGLE_TTS_SPEAKING_RATE ?? "1.0");
const TIMEOUT_MS = 60_000;

/** Cloud TTS 전용 키가 따로 있으면 그걸, 없으면 Gemini 키를 재사용(같은 GCP 프로젝트). */
function apiKey(): string {
  const k = process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY;
  if (!k) throw new GeminiNotConfiguredError();
  return k;
}

/**
 * 짧은 목소리 이름 → Chirp 3: HD 정식 이름.
 *   "Kore" → "ko-KR-Chirp3-HD-Kore"
 * 이미 정식 이름(로케일 접두 포함)이면 그대로 둔다 — 다른 모델(Neural2 등)로 갈아탈 여지를 남긴다.
 */
export function toChirpVoiceName(voice: string, language = GOOGLE_TTS_LANGUAGE): string {
  const v = voice.trim();
  if (/^[a-z]{2}-[A-Z]{2}-/.test(v)) return v; // 이미 정식 이름
  return `${language}-${GOOGLE_TTS_MODEL}-${v}`;
}

// ── WAV 파싱 ────────────────────────────────────────────────
/**
 * WAV 헤더를 실제로 파싱해 재생 길이(초)를 구한다.
 *
 * ★ 왜 상수 계산이 아니라 파서인가: 나레이션 파이프라인은 **오디오 길이로 컷 길이를 역산**한다
 *   (narration.ts computeNarrationTimeline). 길이가 틀리면 영상 전체의 화면·말이 어긋난다.
 *   Gemini 경로는 우리가 헤더를 직접 붙여서 44바이트 고정이 보장됐지만, Cloud TTS가 주는 WAV는
 *   LIST 같은 부가 청크가 낄 수 있어 "44바이트 뒤가 전부 데이터"라는 가정이 깨진다.
 * @returns 길이(초). 파싱 실패 시 null
 */
export function parseWavDuration(wav: Buffer): number | null {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let pos = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let dataBytes = 0;

  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt " && body + 16 <= wav.length) {
      channels = wav.readUInt16LE(body + 2);
      sampleRate = wav.readUInt32LE(body + 4);
      bits = wav.readUInt16LE(body + 14);
    } else if (id === "data") {
      // 스트리밍 인코더가 크기를 0/0xFFFFFFFF로 남기는 경우가 있어 남은 바이트로 보정한다
      const remaining = wav.length - body;
      dataBytes = size > 0 && size <= remaining ? size : remaining;
      break;
    }
    pos = body + size + (size % 2); // 청크는 짝수 바이트 정렬
  }

  const bytesPerSec = (sampleRate * channels * bits) / 8;
  if (!bytesPerSec || !dataBytes) return null;
  return dataBytes / bytesPerSec;
}

interface SynthesizeResponse {
  audioContent?: string;
}

export interface GoogleTtsResult {
  wav: Buffer;
  durationSec: number;
  voiceName: string;
}

/**
 * 문장 1개 → 한국어 나레이션 WAV (Chirp 3: HD).
 * @param voice 짧은 이름("Kore") 또는 정식 이름("ko-KR-Chirp3-HD-Kore")
 * @throws GeminiNotConfiguredError 키 미설정 / Error API 실패·응답 이상
 */
export async function synthesizeWithGoogle(
  text: string,
  voice: string,
  fetchFn: typeof fetch = fetch
): Promise<GoogleTtsResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("TTS 대상 문장이 비어 있습니다");
  const voiceName = toChirpVoiceName(voice);

  const res = await fetchFn(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        // 쉼 태그가 있으면 markup 입력으로 보낸다(text로 보내면 "[pause]"를 그대로 읽는다).
        input: hasPauseTag(trimmed) ? { markup: trimmed } : { text: trimmed },
        voice: { languageCode: GOOGLE_TTS_LANGUAGE, name: voiceName },
        audioConfig: {
          audioEncoding: "LINEAR16",
          sampleRateHertz: 24_000, // Gemini 경로와 동일 규격 → 하류(ffmpeg·타임라인) 분기 없음
          speakingRate: SPEAKING_RATE,
        },
      }),
    }
  );

  if (!res.ok) {
    // ★ 403은 "키가 이 API를 못 쓰게 제한됨(API_KEY_SERVICE_BLOCKED)" 또는 "API 미사용 설정"이다.
    //   콘솔 조치가 필요한 상태라 메시지로 분명히 드러낸다(호출부는 Gemini로 폴백).
    const hint =
      res.status === 403
        ? " — GCP 콘솔에서 Cloud Text-to-Speech API 사용 설정 + 해당 API 키 제한에 texttospeech 추가가 필요합니다"
        : "";
    throw new Error(`Cloud TTS HTTP ${res.status}${hint}`);
  }

  const data = (await res.json()) as SynthesizeResponse;
  if (!data.audioContent) throw new Error("Cloud TTS 응답에 오디오가 없습니다");
  const wav = Buffer.from(data.audioContent, "base64");
  if (wav.length <= 44) throw new Error("Cloud TTS 오디오가 비어 있습니다");

  const durationSec = parseWavDuration(wav);
  if (durationSec == null || durationSec <= 0) {
    // 길이를 못 읽으면 컷 길이 역산이 깨진다 — 조용히 0으로 넘기지 말고 실패시켜 폴백을 태운다
    throw new Error("Cloud TTS WAV 헤더에서 길이를 읽지 못했습니다");
  }

  return { wav, durationSec, voiceName };
}
