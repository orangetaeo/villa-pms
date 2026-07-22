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
import { resolveClipPace } from "@/lib/youtube/pacing";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
// 대본 생성은 구조화 JSON(문장+절 배정)을 요구해 응답이 길다 — 30초로는 부족했다(실측 타임아웃).
// 운영자가 한 번 누르는 작업이라 넉넉히 잡는다(핫 패스 아님).
const GEMINI_TIMEOUT_MS = 120_000;

// ── 대본 규칙 ───────────────────────────────────────────────────────
// ★ 2026-07-22 개정(테오 피드백): 초기값은 "쇼츠=15초" 공식에 맞춘 컷당 18자·5문장이었다.
//   그 제약으로는 입구·수영장·거실·주방·침실N·욕실·발코니를 다 못 보여준다 — 빌라 판매 영상으로 실격.
//   쇼츠 상한이 3분(2024-10 상향)이므로 15초에 스스로를 가둘 이유가 없다.
//   → 컷당 최대 32자(≈5~6초 발화), 최대 16문장. **투어 전체를 보여주는 40~70초**가 새 기본 사거리.
//   자막 2줄까지는 9:16 화면에서 무리 없이 읽힌다.
export const NARRATION_RULES = {
  /** 절(자막 한 장) 최소 글자수 */
  minChars: 6,
  /** 절(자막 한 장) 최대 글자수 — 66px 자막이 두 줄에 들어가는 한계 */
  maxChars: 34,
  /**
   * 문장 전체 최대 글자수. 여러 컷에 걸쳐 흐르므로 절 하나보다 훨씬 길 수 있다.
   * ★ 이게 이 파이프라인의 핵심 변경(테오 2026-07-22): 컷마다 문장을 끝내면
   *   "~예요. ~예요. ~예요."가 되어 사람이 말하는 방식이 아니다.
   *   한 문장이 여러 컷을 이어야 빌라 소개 영상처럼 들린다.
   */
  sentenceMaxChars: 90,
  /**
   * 첫 문장(훅)만 예외적으로 길게 허용한다.
   * 오프닝은 빌라 이름 + 침실 수 + 수영장 + 해변 거리를 한 번에 담아야 한다.
   */
  hookMaxChars: 60,
  /** 문장 수 — CTA 포함. 컷보다 적다(한 문장이 여러 컷을 묶으므로). */
  minLines: 2,
  maxLines: 9,
  /** 권장 총 길이(초) — 하드 상한 아님(edit.ts TOTAL_MAX_SEC=180이 하드 컷) */
  targetTotalSec: 55,
} as const;

/**
 * 장면이 바뀌기 시작한 뒤 말을 시작하기까지의 여유.
 * ★ 이전 값 0.25 + "전환이 **완료된 뒤**에 발화 시작" 규칙 조합은 문장 사이 무음을
 *   LEAD + TAIL + T = 1.0초로 만들었다 → "말이 뚝뚝 끊긴다"(테오 2026-07-22).
 *   실제 영상은 나레이션이 이어지고 그 아래에서 화면이 바뀐다 — 발화를 전환 **시작**에 맞추고
 *   여유를 줄여 문장 간 무음을 LEAD + TAIL = 0.4초(자연스러운 문장 사이 호흡)로 낮췄다.
 */
export const NARRATION_LEAD_SEC = 0.15;
/** 말이 끝난 뒤 다음 전환이 시작되기까지의 여유. 이게 없으면 말끝과 장면 전환이 겹친다. */
export const NARRATION_TAIL_SEC = 0.25;
/** 자막을 말끝보다 조금 더 남긴다(읽을 시간). */
export const SUBTITLE_TAIL_SEC = 0.3;

/**
 * TTS가 잘못 읽는 표기 — 대본에서 금지한다.
 * "V12"·"3BR"·"800m" 같은 숫자·영문은 한국어 TTS가 어색하게 읽는다(계약 리스크 항목).
 * ※ 기존 [[translation-number-preservation]] 교훈의 **정반대 방향** 문제 — 번역은 숫자를 보존해야
 *   하지만, 나레이션은 숫자를 아예 쓰지 말아야 한다.
 */
const FORBIDDEN_CHARS_RE = /[0-9A-Za-z]/;

/**
 * 문장의 한 조각(절) — **컷 하나에 대응**한다. 자막 한 장이기도 하다.
 * ★ 왜 문장을 쪼개는가: 나레이션은 여러 컷에 걸쳐 **이어져야** 자연스럽고(테오 2026-07-22),
 *   자막은 컷마다 바뀌어야 읽힌다. 그래서 음성은 문장 전체로 한 번에 합성하고(끊김 없음),
 *   자막·컷 길이는 절 단위로 나눈다. 절이 바뀌는 순간 화면도 바뀐다.
 */
export interface NarrationPart {
  /**
   * 이 절이 덮는 클립 인덱스들. 보통 1개지만, 모델이 배정하지 않은 컷을 흡수할 때 2개 이상이 된다
   * (같은 자막을 두 번 띄우는 대신 한 절이 두 컷에 걸친다). CTA 절은 빈 배열.
   */
  clipIndexes: number[];
  /** 자막에 표시될 조각 텍스트 */
  text: string;
}

export interface NarrationLine {
  /** 문장 전체 — **TTS 입력**. 절을 이어 붙인 자연스러운 한 문장이어야 한다. */
  text: string;
  /** 컷별 절. 길이 1이면 한 컷짜리 문장, 2 이상이면 여러 컷에 걸쳐 흐르는 문장. */
  parts: NarrationPart[];
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

/** 개수 → 한글 수사. 대본에 아라비아 숫자가 섞이지 않게 한다(TTS 오독 방지). */
function numToKo(n: number): string {
  const ko = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
  return ko[n] ?? String(n);
}

/** 해변까지 거리 → 한국어 표현(숫자 없이). 문 앞이면 그 사실 자체가 최고의 훅이다. */
function beachPhrase(m: number): string {
  if (m <= 150) return "문을 열면 바로 앞이 해변";
  if (m <= 400) return "해변까지 걸어서 몇 걸음";
  if (m <= 1000) return "해변까지 도보 십 분 이내";
  return "해변까지 차로 금방";
}

/**
 * 오프닝 화면에 띄울 스펙 칩 — 나레이션 훅과 **같은 정보**를 음소거 시청자에게도 전달한다.
 * 숫자 없이 한글로(화면 표기는 숫자여도 무방하지만 나레이션과 표현을 맞춰 일관성을 준다).
 */
export function buildIntroSpecs(ctx: NarrationVillaContext): string[] {
  const chips: string[] = [];
  if (ctx.bedrooms) chips.push(`침실 ${numToKo(ctx.bedrooms)} 개`);
  if (ctx.hasPool) chips.push("프라이빗 수영장");
  if (ctx.beachDistanceM != null && ctx.beachDistanceM <= 150) chips.push("해변 바로 앞");
  else if (ctx.beachDistanceM != null && ctx.beachDistanceM <= 400) chips.push("해변 도보 이 분");
  return chips.slice(0, 4);
}

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
      // 페이싱(pacing.ts)과 **같은 판정**을 대본에도 알려준다. 빠르게 지나가는 컷에 긴 설명을
      // 붙이면 화면은 이미 다음 방인데 말이 남는다 — 모델이 짧은 절을 배정하도록 명시한다.
      const kind = resolveClipPace(c.space, c.note).kind;
      const pace = kind === "transit" ? " [지나가는 컷 — 아주 짧게]" : kind === "hero" ? " [핵심 컷 — 여유 있게]" : "";
      return `  컷${i + 1}: ${label}${ord}${note}${pace}`;
    })
    .join("\n");

  const facts: string[] = [];
  if (ctx.complex) facts.push(`단지: ${ctx.complex}`);
  if (ctx.bedrooms) facts.push(`침실 ${numToKo(ctx.bedrooms)} 개`);
  if (ctx.hasPool) facts.push("단독 사용 프라이빗 수영장 있음");
  if (ctx.beachDistanceM != null) {
    // 숫자를 그대로 주면 대본에 숫자가 섞인다 — 정성 표현으로 바꿔 전달한다.
    facts.push(beachPhrase(ctx.beachDistanceM));
  }

  return [
    "너는 한국인 여행객을 대상으로 하는 베트남 푸꾸옥 빌라 홍보 영상의 나레이션 작가다.",
    "이 영상은 빌라를 처음부터 끝까지 둘러보는 투어다.",
    "",
    "★ 가장 중요한 원칙: **컷마다 문장을 끝내지 마라.**",
    "  '~예요. ~예요. ~예요.' 처럼 컷마다 마침표를 찍으면 사람이 말하는 방식이 아니다.",
    "  한 문장이 **여러 컷에 걸쳐 이어지게** 쓴다. 연결어미(~있고, ~있어, ~인데, 그리고)로 흐르게 한다.",
    "",
    "  좋은 예 (컷 두 개를 한 문장으로):",
    "    '우리만 쓰는 프라이빗 수영장과 푸른 정원이 있고, 시원한 통창이 돋보이는 이층 건물이에요'",
    "  좋은 예 (컷 세 개를 한 문장으로):",
    "    '넓은 소파와 선풍기가 있는 편안한 거실, 그리고 따뜻한 원목 식탁이 있는 다이닝 공간이 있어,",
    "     모든 조리도구가 완비된 깨끗한 주방에서 다같이 모여 식사도 가능해요'",
    "  나쁜 예 (금지):",
    "    '편안한 거실이에요' / '다이닝 공간이에요' / '깨끗한 주방이에요'  ← 컷마다 종결",
    "",
    `빌라: ${ctx.villaName}`,
    facts.length ? `특징: ${facts.join(", ")}` : "",
    "",
    "컷 구성:",
    cuts,
    `  마지막 컷: 카카오톡 채널 '빌라고' 검색 안내 (CTA)`,
    "",
    "규칙:",
    `- 문장은 ${NARRATION_RULES.minLines}~${NARRATION_RULES.maxLines}개. **모든 컷이 빠짐없이 어느 문장엔가 속해야 한다.**`,
    "  비슷한 공간(거실·다이닝·주방 / 침실들)은 묶어 한 문장으로 흐르게 하면 자연스럽다.",
    "- **첫 문장은 오프닝 훅이다.** 빌라 이름과 함께 핵심(침실 개수, 수영장, 해변까지 거리)을 담아라.",
    `  첫 문장만 최대 ${NARRATION_RULES.hookMaxChars}자. 단순 인사('환영합니다')로 채우지 마라.`,
    `- 문장 하나는 최대 ${NARRATION_RULES.sentenceMaxChars}자.`,
    `- 각 컷에 붙는 조각(자막 한 장)은 ${NARRATION_RULES.minChars}~${NARRATION_RULES.maxChars}자. **첫 문장(훅)도 예외 없이 조각으로 쪼개라.**`,
    "- **숫자와 영문을 절대 쓰지 마라.** 음성이 이상하게 읽는다. '세 개'처럼 한글로만.",
    "- 문장 끝맺음을 다양하게: ~예요 / ~죠 / ~답니다 / ~해 보세요 / ~가능해요. 같은 어미를 연속으로 쓰지 마라.",
    "- **같은 공간이 여러 컷이면(예: 침실 세 개) 각 컷의 다른 점을 반드시 말하라.**",
    "  '또 다른 침실입니다' 처럼 정보 없는 표현은 금지. 침대 구성·창밖 풍경·누가 쓰기 좋은지를 짚어라.",
    "  컷 설명(— 뒤 텍스트)이 있으면 최우선으로 활용한다.",
    "- **[지나가는 컷]으로 표시된 컷에는 아주 짧은 조각만 붙여라(열 자 안팎).**",
    "  복도·계단은 빠르게 지나가도록 편집되므로, 긴 설명을 붙이면 화면은 벌써 다음 방인데 말이 남는다.",
    "  '이 문을 열면', '올라가 보면' 처럼 다음 공간으로 넘어가는 연결구가 가장 잘 어울린다.",
    "- **[핵심 컷]에는 감각을 담아라.** 색·빛·소리·질감 중 하나는 넣는다",
    "  ('아침 햇살이 들어오는', '발끝에 닿는 시원한 물'). 사실 나열만으로는 마음이 안 움직인다.",
    "- 과장·허위 금지. 화면에 보이는 것만 말한다.",
    "",
    "출력은 JSON만. 각 문장을 text(전체 문장)와 parts(컷별 조각)로 쪼갠다.",
    "parts의 text를 순서대로 이어 붙이면 정확히 text가 되어야 한다(쉼표·조사 포함).",
    "cut 번호는 위 컷 번호(1부터), 마지막 CTA 문장의 cut은 0으로 한다.",
    "",
    '{"lines":[',
    '  {"text":"우리만 쓰는 프라이빗 수영장과 푸른 정원이 있고, 시원한 통창이 돋보이는 이층 건물이에요",',
    '   "parts":[{"cut":2,"text":"우리만 쓰는 프라이빗 수영장과 푸른 정원이 있고,"},',
    '            {"cut":3,"text":"시원한 통창이 돋보이는 이층 건물이에요"}]},',
    '  {"text":"카카오톡에서 빌라고를 검색해 보세요","parts":[{"cut":0,"text":"카카오톡에서 빌라고를 검색해 보세요"}]}',
    "]}",
  ]
    .filter(Boolean)
    .join("\n");
}

// ★ 상한을 하드코딩하지 말 것: 예전 .max(12)가 규칙(maxLines)과 어긋나 13줄이 오면 ZodError로
//   파이프라인 전체가 죽었다(2026-07-22 실측). 규칙에서 파생하고 여유를 둔다.
const scriptSchema = z.object({
  lines: z
    .array(
      z.object({
        text: z.string(),
        parts: z
          .array(z.object({ cut: z.number(), text: z.string() }))
          .min(1)
          .max(20),
      })
    )
    .min(1)
    .max(NARRATION_RULES.maxLines + 4),
});

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
  return normalizeScript(parsed.lines, ctx.clips.length);
}

/**
 * 모델 출력 → 검증된 NarrationLine[]. 모델이 컷 번호를 빠뜨리거나 중복시키는 일이 흔하므로
 * **모든 컷이 정확히 한 번씩** 쓰이도록 서버가 정리한다(프롬프트만 믿지 않는다).
 *   - cut 0 또는 범위 밖 = CTA(clipIndex null)
 *   - 이미 쓰인 컷이 또 나오면 버린다
 *   - 끝까지 안 쓰인 컷은 마지막 비-CTA 문장의 꼬리에 붙인다(화면이 나레이션 없이 지나가지 않게)
 */
export function normalizeScript(
  raw: { text: string; parts: { cut: number; text: string }[] }[],
  clipCount: number
): NarrationLine[] {
  const used = new Set<number>();
  const lines: NarrationLine[] = [];

  for (const l of raw) {
    const parts: NarrationPart[] = [];
    for (const p of l.parts) {
      const text = p.text.trim();
      if (!text) continue;
      const idx = p.cut - 1; // 1-base → 0-base. cut 0 → -1 = CTA
      if (idx < 0 || idx >= clipCount) {
        parts.push({ clipIndexes: [], text }); // CTA
        continue;
      }
      if (used.has(idx)) continue; // 중복 배정 방지
      used.add(idx);
      parts.push({ clipIndexes: [idx], text });
    }
    if (parts.length === 0) continue;
    lines.push({ text: l.text.trim() || parts.map((p) => p.text).join(" "), parts });
  }

  // 누락 컷 보정 — 배정 안 된 컷은 **바로 앞 절이 흡수**한다(그 절의 자막이 두 컷에 걸쳐 유지).
  //   자막을 복제해 같은 문장을 두 번 띄우는 것보다 자연스럽고, 사용자가 올린 컷도 버려지지 않는다.
  for (let idx = 0; idx < clipCount; idx++) {
    if (used.has(idx)) continue;
    let target: NarrationPart | null = null;
    for (const l of lines) {
      for (const p of l.parts) {
        if (p.clipIndexes.some((c) => c < idx)) target = p; // idx보다 앞선 컷을 가진 마지막 절
      }
    }
    // 앞선 절이 없으면(맨 앞 컷이 누락) 첫 절이 흡수한다.
    target ??= lines.find((l) => l.parts.length > 0)?.parts[0] ?? null;
    if (target) {
      target.clipIndexes.push(idx);
      target.clipIndexes.sort((a, b) => a - b);
      used.add(idx);
    }
  }

  // ★ 컷 순서 정규화(QA M-5): edit.ts는 클립을 **인덱스 오름차순**으로 이어 붙인다.
  //   모델이 cut 5를 먼저, cut 1을 나중에 배정하면 오디오는 5번 설명인데 화면은 1번이 나온다
  //   → 전 구간 화면·말 불일치. 절을 최소 clipIndex 기준으로 재정렬해 흐름을 화면 순서와 맞춘다.
  //   (CTA 절은 clipIndexes가 비어 있으므로 항상 맨 뒤로 보낸다.)
  const keyOf = (p: NarrationPart) =>
    p.clipIndexes.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...p.clipIndexes);
  for (const l of lines) l.parts.sort((a, b) => keyOf(a) - keyOf(b));
  lines.sort((a, b) => {
    const ka = Math.min(...a.parts.map(keyOf));
    const kb = Math.min(...b.parts.map(keyOf));
    return ka - kb;
  });

  return lines;
}

// ── ② 검증 (순수함수 — 프롬프트만 믿지 않는다) ──────────────────────
export type NarrationIssue =
  | "EMPTY"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "HAS_DIGIT_OR_LATIN"
  | "PART_TOO_LONG"
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
  const lineIssues = lines.map((l, i): NarrationIssue | null => {
    const t = l.text.trim();
    if (!t) return "EMPTY";
    if (FORBIDDEN_CHARS_RE.test(t)) return "HAS_DIGIT_OR_LATIN";
    if (t.length < NARRATION_RULES.minChars) return "TOO_SHORT";
    // 문장 전체 상한(첫 문장=훅은 더 넉넉). 문장은 여러 컷에 걸쳐 흐르므로 절보다 훨씬 길 수 있다.
    const sentenceMax = i === 0 ? NARRATION_RULES.hookMaxChars : NARRATION_RULES.sentenceMaxChars;
    if (t.length > sentenceMax) return "TOO_LONG";
    // 절(자막 한 장) 상한 — 화면에서 읽히는지가 기준이라 문장 상한과 별개로 본다.
    if (l.parts.some((p) => p.text.trim().length > NARRATION_RULES.maxChars)) return "PART_TOO_LONG";
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
  /** 문장 단위 입력 — 문장별 TTS 길이 + 그 문장의 절 구성(컷 배정·글자수) */
  lines: { durationSec: number; parts: { clipIndexes: number[]; text: string }[] }[];
  /** xfade 전환 길이(초) — edit.ts TRANSITION_SEC */
  transitionSec: number;
  /** 클립 세그먼트 최소 길이(초) — edit.ts CLIP_DUR_MIN */
  minSegmentSec: number;
  /**
   * 컷별 최소 길이 오버라이드(초). 인덱스 = 클립 인덱스. 없으면 minSegmentSec를 쓴다.
   * ★ 이동 컷(복도·계단)만 하한을 낮춰 진짜로 스쳐 지나가게 하려고 있다(pacing.ts minScreenSecFor).
   *   공통 하한 2초를 복도에도 걸면 배속을 해도 "빠르게 지나간다"는 느낌이 안 산다.
   */
  minSegmentSecByClip?: number[];
  /** CTA 정지 카드 최소 길이(초) — edit.ts CTA_DUR_SEC */
  ctaMinSec: number;
}

export interface NarrationTimeline {
  /** 클립 인덱스별 길이(초) — CTA 제외. edit.ts LocalClip.durationSec에 그대로 넣는다 */
  clipDurations: number[];
  /** CTA 카드 길이(초) — edit.ts RenderOpts.ctaDurationSec */
  ctaDurationSec: number;
  /** 문장별 오디오 배치 오프셋(초) */
  lineOffsets: number[];
  /** 자막 구간 — **절 단위**(컷마다 자막이 바뀐다). 텍스트도 함께 돌려준다 */
  subtitles: { text: string; fromSec: number; toSec: number; isCta: boolean }[];
  /** 최종 영상 길이(초) */
  totalSec: number;
}

/**
 * 문장별 오디오 길이 + 절 구성 → 클립 길이·오디오 오프셋·절 단위 자막.
 *
 * ★ 구조(2026-07-22 전면 개정): 예전에는 **컷 하나 = 문장 하나**였다. 그래서 컷마다 문장이
 *   종결되어 "~예요."가 반복됐고, 사람이 말하는 방식이 아니라는 지적을 받았다.
 *   지금은 **문장 하나가 여러 컷에 걸쳐 흐른다.** 음성은 문장 전체를 한 번에 합성하므로
 *   중간에 끊기지 않고, 화면과 자막만 절(節) 경계에서 바뀐다.
 *
 * ★ 전환(xfade)이 세그먼트 양끝을 T초씩 먹는다:
 *   edit.ts xfadeConcat 기준 세그먼트 i로 들어가는 전환은 A_i = Σ_{j<i}(dur_j − T)에서 시작한다.
 *
 * 수식:
 *   절 j의 발화 시간  d_j = D(문장 TTS 길이) × (절 j 글자수 / 문장 글자수)
 *   절 j의 클립 길이  = d_j + T + (문장 첫 절이면 LEAD) + (문장 끝 절이면 TAIL)
 *     → Σ(클립길이 − T) = D + LEAD + TAIL = 그 문장이 차지하는 구간
 *   절이 여러 컷을 덮으면 그 길이를 컷 수로 균등 배분한다.
 *   발화 시작 = 문장 시작 + LEAD (장면이 바뀌기 시작할 때 함께 시작 → 문장 간 무음 0.4초)
 */
export function computeNarrationTimeline(input: NarrationTimelineInput): NarrationTimeline {
  const { lines, transitionSec: T, minSegmentSec, minSegmentSecByClip, ctaMinSec } = input;
  const minFor = (ci: number) => minSegmentSecByClip?.[ci] ?? minSegmentSec;

  const clipDurations: number[] = [];
  const lineOffsets: number[] = [];
  const subtitles: { text: string; fromSec: number; toSec: number; isCta: boolean }[] = [];

  let cursor = 0; // 현재 문장이 시작되는 시각(들어오는 전환 시작 기준)
  let ctaDurationSec = ctaMinSec;

  for (const line of lines) {
    const speechStart = cursor + NARRATION_LEAD_SEC;
    lineOffsets.push(speechStart);

    const totalChars = line.parts.reduce((a, p) => a + Math.max(1, p.text.length), 0);
    let partStart = speechStart;
    let consumed = 0;

    // ★ CTA 문장은 **문장 단위**로 처리한다(QA M-4). 아웃트로는 정지 카드 **1장**이라
    //   절이 2개 이상 와도(모델이 범위 밖 컷 번호를 뱉으면 normalizeScript가 CTA로 흡수한다)
    //   화면은 하나뿐이다. 예전엔 절마다 consumed를 더하고 ctaDurationSec을 대입해서
    //   ⑴ 타임라인이 실제 영상보다 길다고 착각하고 ⑵ 뒤 절이 앞 절 계산을 덮어썼다
    //   → 마지막 CTA 발화가 영상 밖으로 밀려 잘렸다.
    const isCtaLine = line.parts.every((p) => p.clipIndexes.length === 0);

    line.parts.forEach((part, pi) => {
      const share = Math.max(1, part.text.length) / totalChars;
      const partSpeech = line.durationSec * share;

      subtitles.push({
        text: part.text,
        fromSec: partStart,
        toSec: partStart + partSpeech + SUBTITLE_TAIL_SEC,
        isCta: part.clipIndexes.length === 0,
      });

      if (!isCtaLine && part.clipIndexes.length > 0) {
        // 절이 차지하는 화면 시간 = 발화 + (문장 첫 절이면 LEAD) + (문장 끝 절이면 TAIL)
        const head = pi === 0 ? NARRATION_LEAD_SEC : 0;
        const tail = pi === line.parts.length - 1 ? NARRATION_TAIL_SEC : 0;
        const span = partSpeech + head + tail;
        const per = span / part.clipIndexes.length;
        for (const ci of part.clipIndexes) {
          const d = Math.max(minFor(ci), per + T);
          clipDurations[ci] = d;
          // 실제 적용된(하한 반영) 길이로 누적해야 오디오와 화면이 어긋나지 않는다
          consumed += d - T;
        }
      }
      partStart += partSpeech;
    });

    if (isCtaLine) {
      // 카드 1장 = 리드 + 문장 전체 발화 + 테일 (나가는 전환 없음)
      const span = NARRATION_LEAD_SEC + line.durationSec + NARRATION_TAIL_SEC;
      ctaDurationSec = Math.max(ctaMinSec, span);
      consumed = ctaDurationSec;
    }

    cursor += consumed;
  }

  const totalSec = cursor;

  // 영상 끝을 넘는 자막은 잘라낸다
  for (const s of subtitles) s.toSec = Math.min(s.toSec, totalSec);

  return { clipDurations, ctaDurationSec, lineOffsets, subtitles, totalSec };
}

// ── ④-b 실측 재동기화 (video-pacing-quality) ────────────────────────
/**
 * **실제로 렌더된 세그먼트 길이**로 오디오 오프셋·자막 구간을 다시 계산한다.
 *
 * ★ 왜 필요한가(2026-07-23 실측 결함): computeNarrationTimeline이 정한 컷 길이를 세그먼트가
 *   항상 그대로 달성하지는 못한다 — 원본이 짧으면 감속 상한(1.6배)에 걸려 **더 짧게** 나온다.
 *   그런데 오디오 오프셋은 계획값 그대로 깔리므로, 짧아진 만큼 그 뒤 모든 문장이 화면보다
 *   늦게 나온다(누적 드리프트). 컷이 많을수록 어긋남이 커져 마지막엔 다른 방을 설명한다.
 *   → 세그먼트를 다 만든 뒤 **실측 길이로 다시 계산**하면 드리프트가 구조적으로 0이 된다.
 *
 * ★ 부수 효과(의도한 것): 자막이 **컷 경계에 정확히 붙는다.** 예전에는 자막 구간을 글자수 비율로
 *   나눈 발화 시간에 맞췄기 때문에 컷은 바뀌었는데 자막은 남거나 그 반대인 구간이 있었다.
 *   화면이 바뀌는 순간 자막도 바뀌는 편이 훨씬 읽기 쉽다(랜선집구경 릴스 관례).
 *
 * @param lines            문장별 TTS 길이 + 절 구성 (computeNarrationTimeline과 동일 입력)
 * @param actualClipDurs   실측 세그먼트 길이(초). 인덱스 = 클립 인덱스
 * @param actualCtaDur     실측 CTA 카드 길이(초)
 * @param transitionSec    xfade 전환 길이(초)
 */
export function retimeNarrationTimeline(
  lines: { durationSec: number; parts: { clipIndexes: number[]; text: string }[] }[],
  actualClipDurs: number[],
  actualCtaDur: number,
  transitionSec: number
): Pick<NarrationTimeline, "lineOffsets" | "subtitles" | "totalSec"> {
  const T = transitionSec;
  const lineOffsets: number[] = [];
  const subtitles: { text: string; fromSec: number; toSec: number; isCta: boolean }[] = [];
  let cursor = 0;

  for (const line of lines) {
    lineOffsets.push(cursor + NARRATION_LEAD_SEC);
    const isCtaLine = line.parts.every((p) => p.clipIndexes.length === 0);

    if (isCtaLine) {
      subtitles.push({
        text: line.parts.map((p) => p.text).join(" "),
        fromSec: cursor,
        toSec: cursor + actualCtaDur,
        isCta: true,
      });
      cursor += actualCtaDur;
      continue;
    }

    for (const part of line.parts) {
      // 이 절이 화면을 점유하는 시간 = 덮는 컷들의 실측 길이 합 − 전환 겹침
      const span = part.clipIndexes.reduce(
        (a, ci) => a + Math.max(0, (actualClipDurs[ci] ?? 0) - T),
        0
      );
      if (span <= 0) continue; // 배정된 컷이 렌더되지 않은 절(방어) — 자막도 띄우지 않는다
      subtitles.push({
        text: part.text,
        // 자막은 전환이 시작될 때 함께 뜬다(발화보다 LEAD만큼 먼저 — 읽을 시간이 생긴다)
        fromSec: cursor,
        toSec: cursor + span + SUBTITLE_TAIL_SEC,
        isCta: false,
      });
      cursor += span;
    }
  }

  const totalSec = cursor;
  for (const s of subtitles) s.toSec = Math.min(s.toSec, totalSec);
  return { lineOffsets, subtitles, totalSec };
}

// ── ③ 합성 (TTS 호출 묶음) ──────────────────────────────────────────
export interface SynthesizedLine {
  text: string;
  parts: NarrationPart[];
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
      parts: line.parts,
      wav: r.wav,
      durationSec: r.durationSec,
      cached: r.cached,
    });
  }
  return out;
}
