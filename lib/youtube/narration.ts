// lib/youtube/narration.ts — AI 나레이션 대본 생성 · 검증 · 타이밍 (villa-clip-narration-p2)
//
// 파이프라인에서의 위치:
//   빌라 정보 + 클립 공간(PhotoSpace)
//     → ① buildNarrationScript(Gemini)  컷별 1문장 대본
//     → ② validateNarrationLines        규칙 강제(프롬프트만 믿지 않는다)
//     → ③ synthesizeNarration(TTS)      문장별 WAV + 실제 길이
//     → ④ computeNarrationTimeline      **오디오 길이로 컷 길이를 역산**
//     → ⑤ edit.ts 렌더 (자막 = 같은 문장)
//
// ★ 핵심(오디오 우선 타이밍): 기존 edit.ts는 컷 길이를 먼저 정하고(기본 4초) 영상을 잘랐다.
//   나레이션이 들어오면 순서를 뒤집어야 한다 — 안 그러면 말이 컷 전환에서 잘리거나
//   말이 끝난 뒤 어색한 정적이 남는다.
//
// ★ 대본 길이: 한국어 자연 발화 ≈ 초당 5~6음절. 15초 영상의 나레이션 가용 구간 ≈ 13초
//   → 총 65~75자 → **컷당 15~18자 한 문장**. 자막 한 줄에도 딱 맞는 길이다.
//
// ★ 누수 0: 대본 입력에 원가·마진·판매가를 넣지 않는다(빌라명·침실 수·뷰 같은 공개 정보만).
import { z } from "zod";
import { extractJsonFromAIResponse } from "@/lib/ai-utils";
import { GeminiNotConfiguredError } from "@/lib/gemini";
import { synthesizeSpeech, type TtsResult } from "@/lib/gemini-tts";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 30_000;

// ── 대본 규칙 ───────────────────────────────────────────────────────
// ★ 2026-07-22 개정(테오 피드백): 초기값은 "쇼츠=15초" 공식에 맞춘 컷당 18자·5문장이었다.
//   그 제약으로는 입구·수영장·거실·주방·침실N·욕실·발코니를 다 못 보여준다 — 빌라 판매 영상으로 실격.
//   쇼츠 상한이 3분(2024-10 상향)이므로 15초에 스스로를 가둘 이유가 없다.
//   → 컷당 최대 32자(≈5~6초 발화), 최대 16문장. **투어 전체를 보여주는 40~70초**가 새 기본 사거리.
//   자막 2줄까지는 9:16 화면에서 무리 없이 읽힌다.
export const NARRATION_RULES = {
  /** 문장 최소 글자수 — 너무 짧으면 나레이션이 뚝뚝 끊긴다 */
  minChars: 8,
  /** 문장 최대 글자수 — 한국어 초당 5~6음절 기준 ≈ 5.5초 발화. 자막 2줄 한계 */
  maxChars: 32,
  /** 문장(=컷) 수 — CTA 포함. edit.ts CLIP_COUNT_MAX(16) + CTA와 정합 */
  minLines: 3,
  maxLines: 17,
  /** 권장 총 길이(초) — 하드 상한 아님(edit.ts TOTAL_MAX_SEC=180이 하드 컷) */
  targetTotalSec: 55,
} as const;

/** 화면이 온전히 보이기 시작한 뒤 말을 시작하기까지의 여유. 바로 시작하면 급하게 들린다. */
export const NARRATION_LEAD_SEC = 0.25;
/** 말이 끝난 뒤 다음 전환이 시작되기까지의 여유. 이게 없으면 말끝과 장면 전환이 겹친다. */
export const NARRATION_TAIL_SEC = 0.35;
/** 자막을 말끝보다 조금 더 남긴다(읽을 시간). */
export const SUBTITLE_TAIL_SEC = 0.3;

/**
 * TTS가 잘못 읽는 표기 — 대본에서 금지한다.
 * "V12"·"3BR"·"800m" 같은 숫자·영문은 한국어 TTS가 어색하게 읽는다(계약 리스크 항목).
 * ※ 기존 [[translation-number-preservation]] 교훈의 **정반대 방향** 문제 — 번역은 숫자를 보존해야
 *   하지만, 나레이션은 숫자를 아예 쓰지 말아야 한다.
 */
const FORBIDDEN_CHARS_RE = /[0-9A-Za-z]/;

export interface NarrationLine {
  /** 나레이션 = 자막 텍스트 (단일 소스) */
  text: string;
  /** 이 문장이 붙을 클립 인덱스. CTA 문장은 clipIndex = null */
  clipIndex: number | null;
}

// ── ① 대본 생성 (Gemini) ────────────────────────────────────────────
/**
 * 컷 1개의 대본 힌트.
 * ★ note가 왜 필요한가(2026-07-22 테오 피드백): 공간 코드(BEDROOM)만 넘기면 침실이 3컷일 때
 *   모델이 "또 다른 침실입니다"·"세 번째 침실입니다" 같은 **정보 없는 문장**을 만든다.
 *   방마다 무엇이 다른지(킹베드·트윈·정원뷰·화장대)를 넘겨야 컷마다 다른 매력을 짚는다.
 *   실제 파이프라인에서는 VillaClip.note(공급자·운영자 자유 메모)가 이 자리에 들어간다.
 */
export interface NarrationClipHint {
  /** PhotoSpace 값(EXTERIOR·LIVING·POOL…). null이면 미지정 */
  space: string | null;
  /** 이 컷의 구분되는 특징 — 자유 텍스트. 예: "마스터 침실, 킹베드, 정원 통창" */
  note?: string | null;
}

export interface NarrationVillaContext {
  villaName: string;
  complex?: string | null;
  bedrooms?: number | null;
  hasPool?: boolean;
  beachDistanceM?: number | null;
  /** 컷별 힌트 — 순서 = 컷 순서 */
  clips: NarrationClipHint[];
}

/** PhotoSpace → 대본 힌트(한국어). 나레이션 문장이 화면과 어긋나지 않게 한다. */
const SPACE_HINT: Record<string, string> = {
  EXTERIOR: "빌라 외관",
  LIVING: "거실",
  KITCHEN: "주방",
  BEDROOM: "침실",
  BATHROOM: "욕실",
  BALCONY: "베란다·테라스",
  POOL: "수영장",
  ETC: "빌라 내부",
};

function buildPrompt(ctx: NarrationVillaContext): string {
  // 같은 공간이 여러 컷이면 번호를 매겨 모델이 "또 다른 ~"으로 뭉개지 않게 한다.
  const spaceSeen = new Map<string, number>();
  const spaceTotal = new Map<string, number>();
  for (const c of ctx.clips) {
    const k = c.space ?? "ETC";
    spaceTotal.set(k, (spaceTotal.get(k) ?? 0) + 1);
  }

  const cuts = ctx.clips
    .map((c, i) => {
      const k = c.space ?? "ETC";
      const label = c.space ? (SPACE_HINT[c.space] ?? "빌라 내부") : "빌라 (공간 미지정)";
      const total = spaceTotal.get(k) ?? 1;
      const nth = (spaceSeen.get(k) ?? 0) + 1;
      spaceSeen.set(k, nth);
      const ord = total > 1 ? ` (${label} ${nth}/${total})` : "";
      const note = c.note?.trim() ? ` — ${c.note.trim()}` : "";
      return `  컷${i + 1}: ${label}${ord}${note}`;
    })
    .join("\n");

  const facts: string[] = [];
  if (ctx.complex) facts.push(`단지: ${ctx.complex}`);
  if (ctx.bedrooms) facts.push(`침실 ${ctx.bedrooms}개`);
  if (ctx.hasPool) facts.push("개인 수영장 있음");
  if (ctx.beachDistanceM != null) {
    // 숫자를 그대로 주면 대본에 숫자가 섞인다 — 정성 표현으로 바꿔 전달한다.
    facts.push(ctx.beachDistanceM <= 500 ? "해변이 아주 가까움" : "해변까지 차로 금방");
  }

  return [
    "너는 한국인 여행객을 대상으로 하는 베트남 푸꾸옥 빌라 홍보 영상의 나레이션 작가다.",
    "이 영상은 빌라를 **처음부터 끝까지 둘러보는 투어**다. 아래 컷 순서에 맞춰 **컷마다 한 문장씩** 한국어 대본을 쓴다.",
    "",
    `빌라: ${ctx.villaName}`,
    facts.length ? `특징: ${facts.join(", ")}` : "",
    "",
    "컷 구성:",
    cuts,
    `  마지막 컷: 카카오톡 채널 '빌라고' 검색 안내 (CTA)`,
    "",
    "절대 규칙:",
    `- 각 문장은 ${NARRATION_RULES.minChars}~${NARRATION_RULES.maxChars}자. 넘기지 마라(자막 두 줄을 넘긴다).`,
    "- **숫자와 영문을 절대 쓰지 마라.** 음성이 이상하게 읽는다. '세 개', '아주 가까워요'처럼 한글로만.",
    "- 명사 나열 금지. '~예요', '~해요' 같은 완결된 구어체 문장으로.",
    "- 과장·허위 금지. 화면에 보이는 것만 말한다.",
    "- 각 문장은 그 컷 화면과 맞아야 한다.",
    "- 같은 표현을 반복하지 마라. 컷마다 **그 공간의 다른 매력**을 짚는다.",
    "- **같은 공간이 여러 컷이면(예: 침실 세 개) 각 컷의 다른 점을 반드시 말하라.**",
    "  '또 다른 침실입니다', '세 번째 침실입니다' 처럼 정보가 없는 문장은 금지다.",
    "  침대 구성·방 크기·창밖 풍경·누가 쓰기 좋은지 같은 **구체적 차이**를 짚어라.",
    "  컷 설명(— 뒤 텍스트)이 있으면 그 내용을 최우선으로 활용한다.",
    "- 투어처럼 흐르게 써라: 첫 문장은 시선을 끌고, 중간은 공간을 안내하고, 끝은 자연스럽게 마무리한다.",
    "",
    '출력은 JSON만: {"lines": ["문장1", "문장2", ...]}',
  ]
    .filter(Boolean)
    .join("\n");
}

const scriptSchema = z.object({ lines: z.array(z.string()).min(1).max(12) });

interface GeminiTextResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * 빌라·컷 정보 → 나레이션 대본 초안(문장 배열). 마지막 문장은 CTA.
 * @throws GeminiNotConfiguredError 키 미설정 / Error API·파싱 실패
 */
export async function buildNarrationScript(
  ctx: NarrationVillaContext,
  fetchFn: typeof fetch = fetch
): Promise<NarrationLine[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();

  const res = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(ctx) }] }],
        generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API HTTP ${res.status}`);

  const data = (await res.json()) as GeminiTextResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const raw = extractJsonFromAIResponse<Record<string, unknown>>(text);
  if (!raw) throw new Error("나레이션 대본 응답에서 JSON을 추출하지 못했습니다");

  const parsed = scriptSchema.parse(raw);
  const clipCount = ctx.clips.length;
  // 마지막 문장 = CTA(clipIndex null), 앞 문장들은 컷 순서대로 매핑.
  return parsed.lines.map((t, i) => ({
    text: t.trim(),
    clipIndex: i < clipCount ? i : null,
  }));
}

// ── ② 검증 (순수함수 — 프롬프트만 믿지 않는다) ──────────────────────
export type NarrationIssue =
  | "EMPTY"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "HAS_DIGIT_OR_LATIN"
  | "TOO_FEW_LINES"
  | "TOO_MANY_LINES";

export interface NarrationValidation {
  ok: boolean;
  /** 문장별 문제 — 인덱스별. 문제 없으면 null */
  lineIssues: (NarrationIssue | null)[];
  /** 대본 전체 수준 문제 */
  scriptIssues: NarrationIssue[];
}

/**
 * 대본 규칙 검증. Gemini가 규칙을 어기는 일은 흔하므로 서버가 반드시 다시 본다(계약 C6).
 * 운영자 화면이 어느 문장이 왜 잘못됐는지 보여줄 수 있게 인덱스별로 돌려준다.
 */
export function validateNarrationLines(lines: NarrationLine[]): NarrationValidation {
  const lineIssues = lines.map((l): NarrationIssue | null => {
    const t = l.text.trim();
    if (!t) return "EMPTY";
    if (FORBIDDEN_CHARS_RE.test(t)) return "HAS_DIGIT_OR_LATIN";
    if (t.length < NARRATION_RULES.minChars) return "TOO_SHORT";
    if (t.length > NARRATION_RULES.maxChars) return "TOO_LONG";
    return null;
  });

  const scriptIssues: NarrationIssue[] = [];
  if (lines.length < NARRATION_RULES.minLines) scriptIssues.push("TOO_FEW_LINES");
  if (lines.length > NARRATION_RULES.maxLines) scriptIssues.push("TOO_MANY_LINES");

  return {
    ok: lineIssues.every((i) => i === null) && scriptIssues.length === 0,
    lineIssues,
    scriptIssues,
  };
}

// ── ④ 타이밍 (순수함수 — 이 파일의 핵심) ────────────────────────────
export interface NarrationTimelineInput {
  /** 문장별 TTS 실제 길이(초) — 순서 = 대본 순서, 마지막은 CTA */
  lineDurations: number[];
  /** xfade 전환 길이(초) — edit.ts TRANSITION_SEC */
  transitionSec: number;
  /** 세그먼트 최소 길이(초) — edit.ts CLIP_DUR_MIN */
  minSegmentSec: number;
  /** CTA 정지 카드 최소 길이(초) — edit.ts CTA_DUR_SEC */
  ctaMinSec: number;
}

export interface NarrationTimeline {
  /** 세그먼트별 길이(초). 마지막 = CTA 세그먼트 */
  segmentDurations: number[];
  /** 문장별 오디오 배치 오프셋(초) — 최종 타임라인 기준 */
  lineOffsets: number[];
  /** 자막 구간 — 나레이션과 같은 소스에서 파생 */
  subtitleRanges: { fromSec: number; toSec: number }[];
  /** 최종 영상 길이(초) = Σdur − (n−1)·T */
  totalSec: number;
}

/**
 * 문장별 오디오 길이 → 세그먼트 길이·오디오 오프셋·자막 구간.
 *
 * ★ 전환(xfade)이 세그먼트의 **양쪽 끝을 T초씩 먹는다**는 게 이 계산의 핵심이다.
 *   edit.ts xfadeConcat: 세그먼트 i로 들어가는 전환은 `A_i = Σ_{j<i}(dur_j − T)`에서 **시작**해
 *   T초 뒤 완료되고, 다음 전환은 `A_i + dur_i − T`에서 시작한다.
 *   → 세그먼트 i가 **온전히 보이는 구간**은 [A_i + T, A_i + dur_i − T] 뿐이다.
 *
 *   초기 구현은 여유를 전환과 무관한 상수(PAD 0.6)로 잡아, 말이 끝나기 0.05초 전에 이미 다음 컷으로
 *   넘어가기 시작했다("화면이 지나갔는데 나레이션이 늦게 끝난다" — 테오 실측 2026-07-22).
 *
 * 수식:
 *   inSec_i  = (i === 0)     ? 0 : T        // 들어오는 전환(첫 컷은 없음)
 *   outSec_i = (i === n−1)   ? 0 : T        // 나가는 전환(마지막 컷은 없음)
 *   dur_i    = max(floor, inSec_i + LEAD + lineDur_i + TAIL + outSec_i)
 *   off_i    = A_i + inSec_i + LEAD         // 화면이 온전히 보인 뒤 LEAD만큼 지나 발화 시작
 *   total    = Σdur − (n−1)·T
 */
export function computeNarrationTimeline(input: NarrationTimelineInput): NarrationTimeline {
  const { lineDurations, transitionSec: T, minSegmentSec, ctaMinSec } = input;
  const n = lineDurations.length;

  const inSec = (i: number) => (i === 0 ? 0 : T);
  const outSec = (i: number) => (i === n - 1 ? 0 : T);

  const segmentDurations = lineDurations.map((d, i) => {
    const needed = inSec(i) + NARRATION_LEAD_SEC + d + NARRATION_TAIL_SEC + outSec(i);
    const floor = i === n - 1 ? ctaMinSec : minSegmentSec;
    return Math.max(floor, needed);
  });

  const lineOffsets: number[] = [];
  let acc = 0; // acc = A_i (세그먼트 i로 들어가는 전환이 시작되는 시각)
  for (let i = 0; i < n; i++) {
    lineOffsets.push(acc + inSec(i) + NARRATION_LEAD_SEC);
    acc += segmentDurations[i] - T;
  }

  const totalSec = segmentDurations.reduce((a, b) => a + b, 0) - Math.max(0, n - 1) * T;

  const subtitleRanges = lineOffsets.map((off, i) => ({
    fromSec: off,
    toSec: Math.min(totalSec, off + lineDurations[i] + SUBTITLE_TAIL_SEC),
  }));

  return { segmentDurations, lineOffsets, subtitleRanges, totalSec };
}

// ── ③ 합성 (TTS 호출 묶음) ──────────────────────────────────────────
export interface SynthesizedLine {
  text: string;
  clipIndex: number | null;
  wav: Buffer;
  durationSec: number;
  cached: boolean;
}

/**
 * 대본 문장들 → TTS WAV. 캐시가 있으므로 이미 합성된 문장은 API를 타지 않는다(계약 C7).
 * 문장 하나가 실패하면 전체를 실패시킨다 — 일부만 빠진 나레이션은 자막과 어긋나 더 나쁘다.
 */
export async function synthesizeNarration(
  lines: NarrationLine[],
  opts: { voice?: string; fetchFn?: typeof fetch } = {}
): Promise<SynthesizedLine[]> {
  const out: SynthesizedLine[] = [];
  for (const line of lines) {
    const r: TtsResult = await synthesizeSpeech(line.text, opts);
    out.push({
      text: line.text,
      clipIndex: line.clipIndex,
      wav: r.wav,
      durationSec: r.durationSec,
      cached: r.cached,
    });
  }
  return out;
}
