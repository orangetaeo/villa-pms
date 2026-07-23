import { describe, expect, it } from "vitest";
import {
  NARRATION_LEAD_SEC,
  NARRATION_TAIL_SEC,
  NARRATION_RULES,
  computeNarrationTimeline,
  retimeNarrationTimeline,
  normalizeScript,
  reconcilePartsToText,
  absorbTransitParts,
  paginateSubtitle,
  clampSubtitleOverlaps,
  SUBTITLE_PAGE_MAX_CHARS,
  validateNarrationLines,
  diversifyEndings,
  buildSpeechMarkup,
  toKoreanReading,
  PART_PAUSE_SEC,
  type NarrationLine,
} from "./narration";
import { stripPauseTags } from "../gemini-tts";
import { pcmToWav, ttsCacheKey, wavDurationSec } from "../gemini-tts";

// edit.ts 상수와 같은 값 — 타임라인이 실제 렌더 파라미터와 정합해야 의미가 있다.
const T = 0.4; // TRANSITION_SEC
const MIN_SEG = 2; // CLIP_DUR_MIN
const CTA_MIN = 2.8; // CTA_DUR_SEC

const base = { transitionSec: T, minSegmentSec: MIN_SEG, ctaMinSec: CTA_MIN };

/** 한 컷짜리 절 */
const p1 = (clip: number, text: string) => ({ clipIndexes: [clip], text });
/** CTA 절 */
const pCta = (text: string) => ({ clipIndexes: [], text });

// 실제 대본 형태: 한 문장이 여러 컷에 걸쳐 흐른다.
const TOUR = [
  {
    durationSec: 5.4,
    parts: [
      p1(0, "우리만 쓰는 프라이빗 수영장과 푸른 정원이 있고,"),
      p1(1, "시원한 통창이 돋보이는 이층 건물이에요"),
    ],
  },
  {
    durationSec: 7.8,
    parts: [
      p1(2, "넓은 소파와 선풍기가 있는 편안한 거실,"),
      p1(3, "그리고 따뜻한 원목 식탁이 있는 다이닝 공간이 있어,"),
      p1(4, "모든 조리도구가 완비된 주방에서 함께 식사도 가능해요"),
    ],
  },
  { durationSec: 2.4, parts: [pCta("카카오톡에서 빌라고를 검색해 보세요")] },
];

describe("computeNarrationTimeline — 문장이 여러 컷에 걸쳐 흐른다 (핵심 구조)", () => {
  it("한 문장의 절 수만큼 컷 길이가 산출된다", () => {
    const r = computeNarrationTimeline({ lines: TOUR, ...base });
    // 컷 0~4 (문장1이 2컷, 문장2가 3컷) — CTA는 clipDurations에 없다
    expect(r.clipDurations.filter((d) => typeof d === "number")).toHaveLength(5);
    expect(r.ctaDurationSec).toBeGreaterThanOrEqual(CTA_MIN);
  });

  it("절이 긴 만큼 그 컷이 오래 머문다 (글자수 비례)", () => {
    const r = computeNarrationTimeline({ lines: TOUR, ...base });
    // 문장2의 세 절 중 마지막이 가장 길다 → 컷4가 컷2보다 길어야 한다
    expect(r.clipDurations[4]).toBeGreaterThan(r.clipDurations[2]);
  });

  it("자막은 절 단위로 나뉘고 순서대로 이어진다 (컷마다 자막이 바뀐다)", () => {
    const r = computeNarrationTimeline({ lines: TOUR, ...base });
    expect(r.subtitles).toHaveLength(6); // 2 + 3 + 1(CTA)
    for (let i = 1; i < r.subtitles.length; i++) {
      expect(r.subtitles[i].fromSec).toBeGreaterThanOrEqual(r.subtitles[i - 1].fromSec);
    }
    expect(r.subtitles[0].text).toContain("프라이빗 수영장");
    expect(r.subtitles.at(-1)!.isCta).toBe(true);
  });

  it("문장 발화는 그 문장 구간 안에서 끝난다 — 다음 문장과 겹치지 않는다", () => {
    const r = computeNarrationTimeline({ lines: TOUR, ...base });
    for (let i = 0; i + 1 < TOUR.length; i++) {
      const speechEnd = r.lineOffsets[i] + TOUR[i].durationSec;
      expect(speechEnd).toBeLessThanOrEqual(r.lineOffsets[i + 1] + 1e-9);
    }
  });

  it("문장 사이 무음이 0.5초를 넘지 않는다 (뚝뚝 끊기지 않는다)", () => {
    const r = computeNarrationTimeline({ lines: TOUR, ...base });
    for (let i = 0; i + 1 < TOUR.length; i++) {
      const gap = r.lineOffsets[i + 1] - (r.lineOffsets[i] + TOUR[i].durationSec);
      expect(gap).toBeGreaterThan(0);
      // 이전 구현(컷=문장)은 LEAD+TAIL+T = 1.0초라 "말이 뚝뚝 끊긴다"는 지적을 받았다
      expect(gap).toBeLessThanOrEqual(0.5);
    }
  });

  it("★ CTA 나레이션이 영상 끝 전에 끝난다 — 마지막 문장이 잘리면 안 된다", () => {
    const r = computeNarrationTimeline({ lines: TOUR, ...base });
    const cta = TOUR[TOUR.length - 1];
    const speechEnd = r.lineOffsets[r.lineOffsets.length - 1] + cta.durationSec;
    expect(speechEnd).toBeLessThanOrEqual(r.totalSec + 1e-9);
  });

  it("★ CTA 문장이 기본 카드 길이(2.8초)보다 길면 카드가 그만큼 늘어난다", () => {
    // 2.8초 고정이면 이 문장은 끝나기 전에 영상이 끝난다(2026-07-22 실측 결함)
    const lines = [
      { durationSec: 4.0, parts: [p1(0, "첫 컷 문장이에요")] },
      { durationSec: 3.6, parts: [pCta("카카오톡 채널에서 빌라고를 검색해 문의해 주세요")] },
    ];
    const r = computeNarrationTimeline({ lines, ...base });
    expect(r.ctaDurationSec).toBeGreaterThan(CTA_MIN);
    expect(r.ctaDurationSec).toBeCloseTo(NARRATION_LEAD_SEC + 3.6 + NARRATION_TAIL_SEC, 5);
  });

  it("총 길이 = 모든 문장이 차지한 구간의 합", () => {
    const r = computeNarrationTimeline({ lines: TOUR, ...base });
    expect(r.totalSec).toBeGreaterThan(0);
    // 마지막 자막은 영상 끝을 넘지 않는다
    for (const s of r.subtitles) expect(s.toSec).toBeLessThanOrEqual(r.totalSec + 1e-9);
  });

  it("절이 여러 컷을 덮으면 길이를 균등 배분한다", () => {
    const lines = [
      { durationSec: 6.0, parts: [{ clipIndexes: [0, 1], text: "두 컷을 덮는 절이에요" }] },
      { durationSec: 2.0, parts: [pCta("검색해 보세요")] },
    ];
    const r = computeNarrationTimeline({ lines, ...base });
    expect(r.clipDurations[0]).toBeCloseTo(r.clipDurations[1], 5);
  });
});

describe("QA 회귀 — 실제 검증에서 발견된 결함", () => {
  it("M-4: CTA 절이 2개여도 카드는 1장 — 길이가 덮어써지거나 이중 계상되지 않는다", () => {
    // 모델이 범위 밖 cut 번호를 뱉으면 normalizeScript가 CTA로 흡수해 CTA 절이 2개가 될 수 있다.
    // 예전 구현은 ctaDurationSec을 대입(=)해 뒤 절이 앞 절을 덮고, consumed를 절마다 더해
    // 타임라인이 실제 영상보다 길다고 착각 → 마지막 발화가 영상 밖으로 밀려 잘렸다.
    const lines = [
      { durationSec: 4.0, parts: [p1(0, "첫 컷 문장이에요")] },
      {
        durationSec: 3.6,
        parts: [pCta("카카오톡 채널에서"), pCta("빌라고를 검색해 주세요")],
      },
    ];
    const r = computeNarrationTimeline({ lines, ...base });
    // 카드 1장 = LEAD + 문장 전체 발화 + TAIL
    expect(r.ctaDurationSec).toBeCloseTo(NARRATION_LEAD_SEC + 3.6 + NARRATION_TAIL_SEC, 5);
    // 마지막 발화가 영상 안에서 끝난다(이게 깨지면 CTA가 잘린다)
    const lastEnd = r.lineOffsets[1] + 3.6;
    expect(lastEnd).toBeLessThanOrEqual(r.totalSec + 1e-9);
  });

  it("M-5: 모델이 컷 순서를 뒤집어 배정해도 화면 순서(인덱스 오름차순)로 정렬된다", () => {
    // edit.ts는 클립을 인덱스 순으로 이어 붙인다 — 정렬하지 않으면 오디오와 화면이 전 구간 어긋난다.
    const lines = normalizeScript(
      [
        { text: "다섯째 컷 설명", parts: [{ cut: 5, text: "다섯째 컷 설명" }] },
        { text: "첫째 컷 설명", parts: [{ cut: 1, text: "첫째 컷 설명" }] },
        { text: "검색해 보세요", parts: [{ cut: 0, text: "검색해 보세요" }] },
      ],
      5
    );
    const firstAssigned = Math.min(...lines[0].parts.flatMap((p) => p.clipIndexes));
    const secondAssigned = Math.min(...lines[1].parts.flatMap((p) => p.clipIndexes));
    expect(firstAssigned).toBeLessThan(secondAssigned); // 앞 문장이 앞 컷을 덮는다
    expect(lines[0].text).toBe("첫째 컷 설명");
    // CTA는 항상 맨 뒤
    expect(lines.at(-1)!.parts.every((p) => p.clipIndexes.length === 0)).toBe(true);
  });
});

describe("normalizeScript — 모델 출력 정리", () => {
  it("cut 번호(1-base)를 클립 인덱스(0-base)로 바꾸고 CTA는 cut 0", () => {
    const lines = normalizeScript(
      [
        { text: "가나다 라마바", parts: [{ cut: 1, text: "가나다" }, { cut: 2, text: "라마바" }] },
        { text: "검색해 보세요", parts: [{ cut: 0, text: "검색해 보세요" }] },
      ],
      2
    );
    expect(lines[0].parts[0].clipIndexes).toEqual([0]);
    expect(lines[0].parts[1].clipIndexes).toEqual([1]);
    expect(lines[1].parts[0].clipIndexes).toEqual([]); // CTA
  });

  it("같은 컷을 두 번 배정하면 뒤엣것을 버린다", () => {
    const lines = normalizeScript(
      [{ text: "가 나", parts: [{ cut: 1, text: "가" }, { cut: 1, text: "나" }] }],
      2
    );
    const assigned = lines.flatMap((l) => l.parts.flatMap((p) => p.clipIndexes));
    expect(assigned.filter((c) => c === 0)).toHaveLength(1);
  });

  it("★ 배정 안 된 컷은 앞 절이 흡수한다 — 사용자가 올린 컷이 버려지지 않는다", () => {
    // 컷 3개인데 모델이 컷1만 배정
    const lines = normalizeScript([{ text: "가나다", parts: [{ cut: 1, text: "가나다" }] }], 3);
    const assigned = lines.flatMap((l) => l.parts.flatMap((p) => p.clipIndexes)).sort();
    expect(assigned).toEqual([0, 1, 2]);
  });
});

describe("validateNarrationLines", () => {
  const line = (text: string, parts?: { clipIndexes: number[]; text: string }[]): NarrationLine => ({
    text,
    parts: parts ?? [{ clipIndexes: [0], text }],
  });

  it("규칙을 지킨 대본은 통과 — 긴 훅도 절로 쪼개면 자막이 읽힌다", () => {
    // ★ 훅은 문장 상한(60자)까지 길 수 있지만, **자막 한 장(절)은 34자 이내**여야 화면에서 읽힌다.
    //   그래서 훅도 다른 문장과 똑같이 절로 나뉘어야 한다(프롬프트가 요구하는 형태).
    const hook = "침실 세 개에 프라이빗 수영장, 문 열면 바로 해변인 엠빌라예요";
    const r = validateNarrationLines([
      line(hook, [
        { clipIndexes: [0], text: "침실 세 개에 프라이빗 수영장," },
        { clipIndexes: [1], text: "문 열면 바로 해변인 엠빌라예요" },
      ]),
      line("넓은 소파가 있는 거실이 편안해요"),
      line("카카오톡에서 빌라고를 찾으세요"),
    ]);
    expect(r.ok).toBe(true);
  });

  it("숫자·영문이 들어가면 거부 — TTS가 이상하게 읽는다", () => {
    const r = validateNarrationLines([
      line("침실이 3개 있는 집이에요"),
      line("소나시 V열두동 빌라예요"),
      line("카카오톡에서 빌라고를 찾으세요"),
    ]);
    expect(r.lineIssues[0]).toBe("HAS_DIGIT_OR_LATIN");
    expect(r.lineIssues[1]).toBe("HAS_DIGIT_OR_LATIN");
    expect(r.ok).toBe(false);
  });

  it("여러 컷에 걸친 긴 문장은 통과한다 — 절 상한보다 훨씬 길 수 있다", () => {
    const long =
      "넓은 소파와 선풍기가 있는 편안한 거실, 그리고 따뜻한 원목 식탁이 있는 다이닝 공간이 있어, 주방에서 함께 식사도 가능해요";
    expect(long.length).toBeGreaterThan(NARRATION_RULES.maxChars); // 절 상한 초과
    expect(long.length).toBeLessThanOrEqual(NARRATION_RULES.sentenceMaxChars);
    const r = validateNarrationLines([
      line("첫 문장은 훅이에요"),
      line(long, [
        { clipIndexes: [1], text: "넓은 소파와 선풍기가 있는 편안한 거실," },
        { clipIndexes: [2], text: "그리고 따뜻한 원목 식탁이 있는 다이닝 공간이 있어," },
        { clipIndexes: [3], text: "주방에서 함께 식사도 가능해요" },
      ]),
      line("검색해 보세요"),
    ]);
    expect(r.lineIssues[1]).toBeNull();
  });

  it("절 하나가 자막 상한을 넘으면 PART_TOO_LONG — 화면에서 안 읽힌다", () => {
    const longPart = "가".repeat(NARRATION_RULES.maxChars + 1);
    const r = validateNarrationLines([
      line("첫 문장은 훅이에요"),
      line(longPart, [{ clipIndexes: [1], text: longPart }]),
      line("검색해 보세요"),
    ]);
    expect(r.lineIssues[1]).toBe("PART_TOO_LONG");
  });

  it("문장 수가 범위 밖이면 대본 수준 문제로 잡힌다", () => {
    // ★ 개수를 하드코딩하지 않는다 — NARRATION_RULES에서 파생한다.
    const ok = line("괜찮은 문장이에요");
    const tooFew = Array.from({ length: NARRATION_RULES.minLines - 1 }, () => ok);
    const tooMany = Array.from({ length: NARRATION_RULES.maxLines + 1 }, () => ok);
    expect(validateNarrationLines(tooFew).scriptIssues).toContain("TOO_FEW_LINES");
    expect(validateNarrationLines(tooMany).scriptIssues).toContain("TOO_MANY_LINES");
  });
});

describe("gemini-tts WAV 유틸", () => {
  it("pcmToWav는 44바이트 RIFF 헤더를 붙인다", () => {
    const pcm = Buffer.alloc(48_000); // 24kHz mono 16bit → 1초
    const wav = pcmToWav(pcm);
    expect(wav.length).toBe(pcm.length + 44);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24_000);
  });

  it("wavDurationSec는 ffprobe 없이 길이를 계산한다", () => {
    expect(wavDurationSec(pcmToWav(Buffer.alloc(48_000)))).toBeCloseTo(1.0, 6);
  });

  it("캐시 키는 문장·목소리·모델에 모두 반응한다", () => {
    const a = ttsCacheKey("안녕하세요", "Kore", "m1");
    expect(ttsCacheKey("안녕하세요", "Kore", "m1")).toBe(a);
    expect(ttsCacheKey("안녕하세요!", "Kore", "m1")).not.toBe(a);
    expect(ttsCacheKey("안녕하세요", "Puck", "m1")).not.toBe(a);
    expect(ttsCacheKey("안녕하세요", "Kore", "m2")).not.toBe(a);
  });
});

// ── 실측 재동기화 (video-pacing-quality) ─────────────────────────────
describe("retimeNarrationTimeline — 계획이 아니라 실측 길이로 다시 맞춘다", () => {
  const lines = [
    {
      durationSec: 3.0,
      parts: [
        { clipIndexes: [0], text: "첫 컷 설명" },
        { clipIndexes: [1], text: "둘째 컷 설명" },
      ],
    },
    { durationSec: 2.0, parts: [{ clipIndexes: [2], text: "셋째 컷 설명" }] },
    { durationSec: 2.4, parts: [{ clipIndexes: [], text: "카카오톡에서 빌라고를 검색해 보세요" }] },
  ];

  it("합계가 xfade 결과 길이와 정확히 일치한다 (Σd − 컷수×T)", () => {
    const clipDurs = [3.0, 2.6, 2.2];
    const ctaDur = 2.8;
    const r = retimeNarrationTimeline(lines, clipDurs, ctaDur, T);
    const xfadeTotal = clipDurs.reduce((a, b) => a + b, 0) + ctaDur - clipDurs.length * T;
    expect(r.totalSec).toBeCloseTo(xfadeTotal, 6);
  });

  it("컷이 계획보다 짧게 나오면 그 뒤 문장 오프셋이 **앞당겨진다**(드리프트 제거)", () => {
    const planned = retimeNarrationTimeline(lines, [4, 4, 4], 2.8, T);
    const shrunk = retimeNarrationTimeline(lines, [4, 4, 2], 2.8, T); // 셋째 컷이 2초 짧게 렌더됨
    // 셋째 컷 이전 문장은 그대로, 이후(CTA) 문장은 2초 당겨져야 한다
    expect(shrunk.lineOffsets[0]).toBeCloseTo(planned.lineOffsets[0], 6);
    expect(shrunk.lineOffsets[1]).toBeCloseTo(planned.lineOffsets[1], 6);
    expect(planned.lineOffsets[2] - shrunk.lineOffsets[2]).toBeCloseTo(2, 6);
  });

  it("자막이 컷 경계에 정확히 붙는다 — 앞 자막이 끝나는 곳에서 다음 자막이 시작", () => {
    const r = retimeNarrationTimeline(lines, [3, 2.6, 2.2], 2.8, T);
    const nonCta = r.subtitles.filter((s) => !s.isCta);
    expect(nonCta).toHaveLength(3);
    expect(nonCta[0].fromSec).toBeCloseTo(0, 6);
    expect(nonCta[1].fromSec).toBeCloseTo(3 - T, 6); // 첫 컷이 차지한 화면 시간
    expect(nonCta[2].fromSec).toBeCloseTo(3 - T + (2.6 - T), 6);
  });

  it("자막은 발화보다 LEAD만큼 먼저 뜬다 — 읽을 시간을 준다", () => {
    const r = retimeNarrationTimeline(lines, [3, 2.6, 2.2], 2.8, T);
    expect(r.lineOffsets[0] - r.subtitles[0].fromSec).toBeCloseTo(NARRATION_LEAD_SEC, 6);
  });

  it("어떤 자막도 영상 끝을 넘지 않는다", () => {
    const r = retimeNarrationTimeline(lines, [3, 2.6, 2.2], 2.8, T);
    for (const s of r.subtitles) expect(s.toSec).toBeLessThanOrEqual(r.totalSec + 1e-9);
  });

  it("렌더되지 않은 컷을 가리키는 절은 자막을 만들지 않는다(방어)", () => {
    const r = retimeNarrationTimeline(lines, [3, 2.6], 2.8, T); // 컷 2가 없음
    expect(r.subtitles.filter((s) => s.text === "셋째 컷 설명")).toHaveLength(0);
  });
});

// ── 절 재구성 (프롬프트만 믿지 않는다) ───────────────────────────────
describe("reconcilePartsToText — 절이 문장 전체를 덮게 맞춘다", () => {
  const norm = (s: string) => s.replace(/[\s.,'"·]/g, "");

  it("이미 정합이면 손대지 않는다", () => {
    const line: NarrationLine = {
      text: "우리만 쓰는 수영장이 있고, 통창이 시원한 거실이에요",
      parts: [
        { clipIndexes: [0], text: "우리만 쓰는 수영장이 있고," },
        { clipIndexes: [1], text: "통창이 시원한 거실이에요" },
      ],
    };
    expect(reconcilePartsToText(line)).toEqual(line);
  });

  // ★ 실측 사례(2026-07-23): 모델이 문장은 다 써놓고 앞 절만 컷에 배정했다.
  //   그대로 두면 ⑴ 자막에 뒷부분이 안 나오고 ⑵ 컷 길이 배분까지 부풀어 오른다.
  it("절이 문장 뒷부분을 빠뜨리면 text 기준으로 다시 나눈다", () => {
    const line: NarrationLine = {
      text: "엠빌라는 네 개의 침실과 단독 수영장, 그리고 해변이 바로 앞에 펼쳐진답니다.",
      parts: [{ clipIndexes: [0], text: "엠빌라는 네 개의 침실과" }],
    };
    const r = reconcilePartsToText(line);
    expect(norm(r.parts.map((p) => p.text).join(""))).toBe(norm(line.text));
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].clipIndexes).toEqual([0]);
  });

  it("컷 배정(순서·인덱스)은 모델 것을 그대로 존중한다", () => {
    const line: NarrationLine = {
      text: "햇살 가득한 입구를 지나 내부 복도를 통해 들어서면, 푸른 수영장이 보이는 거실이 여러분을 맞이합니다.",
      parts: [
        { clipIndexes: [1], text: "내부 복도를 통해 들어서면," },
        { clipIndexes: [2], text: "푸른 수영장이 보이는" },
      ],
    };
    const r = reconcilePartsToText(line);
    expect(r.parts.map((p) => p.clipIndexes)).toEqual([[1], [2]]);
    expect(norm(r.parts.map((p) => p.text).join(""))).toBe(norm(line.text));
    // 순서가 보존된다 — 첫 절은 문장의 앞머리, 둘째 절이 그 뒤를 잇는다
    expect(line.text.startsWith(r.parts[0].text)).toBe(true);
    expect(line.text.endsWith(r.parts[1].text)).toBe(true);
    // 배분 비율은 모델이 준 절 길이 비율을 따른다(14:10 → 앞이 더 김)
    expect(r.parts[0].text.length).toBeGreaterThanOrEqual(r.parts[1].text.length);
  });

  it("모든 절이 비지 않는다 — 빈 절은 그 컷이 나레이션 없이 지나간다는 뜻", () => {
    const line: NarrationLine = {
      text: "짧아요",
      parts: [
        { clipIndexes: [0], text: "짧" },
        { clipIndexes: [1], text: "아요" },
        { clipIndexes: [2], text: "!" },
      ],
    };
    const r = reconcilePartsToText(line);
    for (const p of r.parts) expect(p.text.length).toBeGreaterThan(0);
    // 어절이 모자라면 뒤 컷들을 마지막 절에 합친다(컷을 잃지 않는다)
    expect(r.parts.flatMap((p) => p.clipIndexes).sort()).toEqual([0, 1, 2]);
  });

  it("normalizeScript가 마지막에 재구성을 거친다(단일 관문)", () => {
    const lines = normalizeScript(
      [
        {
          text: "엠빌라는 네 개의 침실과 단독 수영장, 그리고 해변이 바로 앞이에요",
          parts: [{ cut: 1, text: "엠빌라는 네 개의 침실과" }],
        },
        { text: "카카오톡에서 빌라고를 검색해 보세요", parts: [{ cut: 0, text: "카카오톡에서 빌라고를 검색해 보세요" }] },
      ],
      1
    );
    expect(norm(lines[0].parts.map((p) => p.text).join(""))).toBe(norm(lines[0].text));
  });
});

// ── 자막 가독성 (실빌라 렌더 교훈) ────────────────────────────────────
describe("paginateSubtitle — 긴 자막은 여러 장으로 넘긴다", () => {
  it("짧으면 한 장 그대로", () => {
    const p = paginateSubtitle("넓은 거실이에요", 0, 3);
    expect(p).toEqual([{ text: "넓은 거실이에요", fromSec: 0, toSec: 3 }]);
  });

  // ★ 실측(2026-07-23): 62자 훅 문장이 컷 하나에 통째로 배정되어 알약 5줄이 화면 절반을 덮었다.
  it("상한을 넘으면 나눈다 — 각 장이 상한 이하", () => {
    const long = "쏘나씨 단지에 위치한 엠빌라는 침실 네 개와 단독 프라이빗 수영장을 갖추고 있고, 문을 열면 바로 앞이 해변이랍니다.";
    const pages = paginateSubtitle(long, 0, 8);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p.text.length).toBeLessThanOrEqual(SUBTITLE_PAGE_MAX_CHARS + 8);
  });

  it("내용을 잃지 않는다", () => {
    const long = "쏘나씨 단지에 위치한 엠빌라는 침실 네 개와 단독 프라이빗 수영장을 갖추고 있고, 문을 열면 바로 앞이 해변이랍니다.";
    const joined = paginateSubtitle(long, 0, 8).map((p) => p.text).join(" ");
    expect(joined.replace(/\s/g, "")).toBe(long.replace(/\s/g, ""));
  });

  it("장들이 원래 구간을 빈틈없이 이어 채운다", () => {
    const pages = paginateSubtitle("가".repeat(20) + " " + "나".repeat(20) + " " + "다".repeat(20), 2, 10);
    expect(pages[0].fromSec).toBeCloseTo(2, 6);
    expect(pages[pages.length - 1].toSec).toBeCloseTo(10, 6);
    for (let i = 0; i < pages.length - 1; i++) {
      expect(pages[i].toSec).toBeCloseTo(pages[i + 1].fromSec, 6);
    }
  });
});

describe("clampSubtitleOverlaps — 자막 두 장이 동시에 뜨지 않는다", () => {
  // ★ 실측(2026-07-23): 절 끝의 읽을 시간(TAIL)이 다음 절 시작을 넘어가, 컷 전환 구간에서
  //   줄 수가 다른 두 자막이 위아래로 포개져 둘 다 못 읽는 상태가 됐다.
  it("앞 자막의 끝을 다음 자막의 시작으로 자른다", () => {
    const subs = [
      { text: "a", fromSec: 0, toSec: 3.3 },
      { text: "b", fromSec: 3.0, toSec: 6.3 },
      { text: "c", fromSec: 6.0, toSec: 9.0 },
    ];
    clampSubtitleOverlaps(subs);
    expect(subs[0].toSec).toBeCloseTo(3.0, 6);
    expect(subs[1].toSec).toBeCloseTo(6.0, 6);
    expect(subs[2].toSec).toBeCloseTo(9.0, 6); // 마지막은 그대로(읽을 시간 유지)
  });

  it("겹치지 않으면 손대지 않는다", () => {
    const subs = [
      { text: "a", fromSec: 0, toSec: 2 },
      { text: "b", fromSec: 3, toSec: 5 },
    ];
    clampSubtitleOverlaps(subs);
    expect(subs[0].toSec).toBe(2);
  });

  it("실제 타임라인 산출물에 겹침이 하나도 없다", () => {
    const t = computeNarrationTimeline({
      lines: [
        { durationSec: 5, parts: [{ clipIndexes: [0], text: "첫 컷 설명입니다" }, { clipIndexes: [1], text: "둘째 컷 설명입니다" }] },
        { durationSec: 3, parts: [{ clipIndexes: [2], text: "셋째 컷 설명입니다" }] },
        { durationSec: 2, parts: [{ clipIndexes: [], text: "카카오톡에서 빌라고를 검색해 보세요" }] },
      ],
      ...base,
    });
    for (let i = 0; i < t.subtitles.length - 1; i++) {
      expect(t.subtitles[i].toSec).toBeLessThanOrEqual(t.subtitles[i + 1].fromSec + 1e-9);
    }
  });

  it("재동기화 산출물에도 겹침이 없다", () => {
    const lines = [
      { durationSec: 5, parts: [{ clipIndexes: [0], text: "첫 컷 설명입니다" }, { clipIndexes: [1], text: "둘째 컷 설명입니다" }] },
      { durationSec: 2, parts: [{ clipIndexes: [], text: "카카오톡에서 빌라고를 검색해 보세요" }] },
    ];
    const r = retimeNarrationTimeline(lines, [3, 2.6], 2.8, T);
    for (let i = 0; i < r.subtitles.length - 1; i++) {
      expect(r.subtitles[i].toSec).toBeLessThanOrEqual(r.subtitles[i + 1].fromSec + 1e-9);
    }
  });
});

describe("reconcilePartsToText — 절 경계에서 끊는다", () => {
  it("쉼표 근처에서 끊어 수식어 한가운데를 피한다", () => {
    // 실측 사례: "이 문을 열고 들어서면, 따뜻한 / 햇살이…" 처럼 '따뜻한'에서 끊겼다.
    const line: NarrationLine = {
      text: "이 문을 열고 들어서면, 따뜻한 햇살이 가득 들어오는 거실이 푸른 수영장 뷰를 품고 있어요",
      parts: [
        { clipIndexes: [1], text: "이 문을 열고" },
        { clipIndexes: [2], text: "햇살이 가득 들어오는 거실이 푸른 수영장 뷰를 품고 있어요" },
      ],
    };
    const r = reconcilePartsToText(line);
    expect(r.parts[0].text.endsWith(",")).toBe(true);
    expect(r.parts[1].text.startsWith("따뜻한")).toBe(true);
  });
});

describe("computeNarrationTimeline — 이동 컷 상한과 재분배", () => {
  const mk = (n: number) => ({
    durationSec: 6,
    parts: Array.from({ length: n }, (_, i) => ({ clipIndexes: [i], text: "가나다라마바사아자차" })),
  });

  it("상한을 넘는 이동 컷은 깎이고, 깎인 시간은 다른 컷이 가져간다", () => {
    const capped = computeNarrationTimeline({
      lines: [mk(3)],
      ...base,
      maxSegmentSecByClip: [null, 1.9, null],
    });
    const plain = computeNarrationTimeline({ lines: [mk(3)], ...base });
    expect(capped.clipDurations[1]).toBeLessThan(plain.clipDurations[1]);
    expect(capped.clipDurations[0]).toBeGreaterThan(plain.clipDurations[0]);
    expect(capped.clipDurations[2]).toBeGreaterThan(plain.clipDurations[2]);
  });

  it("문장 총 길이는 보존된다 — 재분배지 삭제가 아니다", () => {
    const capped = computeNarrationTimeline({ lines: [mk(3)], ...base, maxSegmentSecByClip: [null, 1.9, null] });
    const plain = computeNarrationTimeline({ lines: [mk(3)], ...base });
    expect(capped.totalSec).toBeCloseTo(plain.totalSec, 6);
  });

  it("상한이 없으면 기존과 완전히 같다", () => {
    const a = computeNarrationTimeline({ lines: [mk(3)], ...base, maxSegmentSecByClip: [null, null, null] });
    const b = computeNarrationTimeline({ lines: [mk(3)], ...base });
    expect(a.clipDurations).toEqual(b.clipDurations);
  });
});

// ── 이동 컷 흡수 (테오 지적: 나레이션과 화면이 어긋난다) ──────────────
describe("absorbTransitParts — 이동 컷은 자기 자막을 갖지 않는다", () => {
  // ★ 실측(2026-07-23): 컷19가 "욕실에서 나오는 이동"인데 모델이 "편안한 킹베드와 티브이,"를
  //   배정했다. 침대 나레이션이 나오는데 화면은 아직 샤워실이었다.
  const kinds = ["hero", "hero", "transit", "hero", "hero"];

  it("이동 컷이 앞 절에 흡수되고 절 수가 줄어든다", () => {
    const line: NarrationLine = {
      text: "화장대와 옷장, 샤워부스와 욕조를 갖춘 욕실, 편안한 킹베드와 티브이, 베란다를 열면 바다예요",
      parts: [
        { clipIndexes: [0], text: "화장대와 옷장," },
        { clipIndexes: [1], text: "샤워부스와 욕조를 갖춘 욕실," },
        { clipIndexes: [2], text: "편안한 킹베드와 티브이," },
        { clipIndexes: [3], text: "베란다를 열면" },
        { clipIndexes: [4], text: "바다예요" },
      ],
    };
    const r = absorbTransitParts(line, kinds);
    expect(r.parts).toHaveLength(4);
    // 이동 컷 2는 앞 절(컷1)이 함께 덮는다 — 샤워실 자막이 나오는 동안 이동까지 이어진다
    expect(r.parts[1].clipIndexes).toEqual([1, 2]);
    expect(r.parts.map((p) => p.clipIndexes)).toEqual([[0], [1, 2], [3], [4]]);
  });

  it("흡수 후 재구성까지 거치면 침대 설명이 침대 컷으로 옮겨간다", () => {
    const lines = normalizeScript(
      [
        {
          text: "화장대와 옷장, 샤워부스와 욕조를 갖춘 욕실, 편안한 킹베드와 티브이, 베란다를 열면 바다예요",
          parts: [
            { cut: 1, text: "화장대와 옷장," },
            { cut: 2, text: "샤워부스와 욕조를 갖춘 욕실," },
            { cut: 3, text: "편안한 킹베드와 티브이," },
            { cut: 4, text: "베란다를 열면" },
            { cut: 5, text: "바다예요" },
          ],
        },
      ],
      5,
      kinds
    );
    const parts = lines[0].parts;
    // 침대 컷(인덱스 3)의 자막에 '킹베드'가 와야 한다 — 예전엔 이동 컷(2)에 붙어 어긋났다
    const bedPart = parts.find((p) => p.clipIndexes.includes(3));
    expect(bedPart?.text).toContain("킹베드");
    // 이동 컷(2)은 앞 절과 같은 자막을 공유한다
    const withTransit = parts.find((p) => p.clipIndexes.includes(2));
    expect(withTransit?.clipIndexes).toContain(1);
  });

  it("문장 맨 앞이 이동 컷이면 다음 절이 끌어안는다", () => {
    const line: NarrationLine = {
      text: "거실 옆으로는 욕실이 있어요",
      parts: [
        { clipIndexes: [0], text: "거실" },
        { clipIndexes: [1], text: "옆으로는 욕실이 있어요" },
      ],
    };
    const r = absorbTransitParts(line, ["transit", "hero"]);
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].clipIndexes).toEqual([0, 1]);
  });

  it("이동 컷이 없으면 손대지 않는다", () => {
    const line: NarrationLine = {
      text: "가나 다라",
      parts: [
        { clipIndexes: [0], text: "가나" },
        { clipIndexes: [1], text: "다라" },
      ],
    };
    expect(absorbTransitParts(line, ["hero", "hero"])).toEqual(line);
  });

  it("clipKinds를 안 주면 기존 동작 그대로(무변경)", () => {
    const a = normalizeScript([{ text: "가나 다라", parts: [{ cut: 1, text: "가나" }, { cut: 2, text: "다라" }] }], 2);
    const b = normalizeScript([{ text: "가나 다라", parts: [{ cut: 1, text: "가나" }, { cut: 2, text: "다라" }] }], 2, undefined);
    expect(a).toEqual(b);
    expect(a[0].parts).toHaveLength(2);
  });
});

// ── 어미 반복 교정 (테오 2026-07-23: "답니다~ 답니다~ 이런 문맥은 너무 이상해") ──
describe("diversifyEndings — 같은 어미 반복은 서버가 바꾼다", () => {
  const line = (text: string, cut = 1): NarrationLine => ({
    text,
    parts: [{ clipIndexes: [cut - 1], text }],
  });

  it("첫 등장은 두고 두 번째부터 바꾼다", () => {
    const out = diversifyEndings([
      line("전망을 자랑한답니다."),
      line("편안함을 더해준답니다.", 2),
      line("멋진 풍경이 펼쳐진답니다.", 3),
      line("해변을 내려다볼 수 있답니다.", 4),
    ]);
    expect(out[0].text).toBe("전망을 자랑한답니다."); // 첫 문장은 유지
    expect(out.slice(1).every((l) => !l.text.includes("답니다"))).toBe(true);
    expect(out[1].text).toBe("편안함을 더해주죠.");
    expect(out[2].text).toBe("멋진 풍경이 펼쳐져요.");
    expect(out[3].text).toBe("해변을 내려다볼 수 있어요.");
  });

  it("문장과 마지막 절이 함께 바뀐다(자막과 말이 어긋나지 않게)", () => {
    const out = diversifyEndings([
      line("바다가 보인답니다."),
      {
        text: "넓은 거실과 통창이 있고, 정원이 펼쳐진답니다.",
        parts: [
          { clipIndexes: [1], text: "넓은 거실과 통창이 있고," },
          { clipIndexes: [2], text: "정원이 펼쳐진답니다." },
        ],
      },
    ]);
    const last = out[1].parts[out[1].parts.length - 1];
    expect(out[1].text.endsWith(last.text)).toBe(true);
    expect(out[1].text).not.toContain("답니다");
  });

  it("CTA 문장은 건드리지 않는다", () => {
    const cta: NarrationLine = {
      text: "카카오톡에서 빌라고를 검색해 보세요.",
      parts: [{ clipIndexes: [], text: "카카오톡에서 빌라고를 검색해 보세요." }],
    };
    expect(diversifyEndings([line("바다가 보여요."), cta])[1]).toEqual(cta);
  });

  it("바꿀 규칙이 없는 어미는 원문 그대로 둔다(억지 변형 금지)", () => {
    const odd = line("바다가 보이는 곳");
    const out = diversifyEndings([line("바다가 보이는 곳"), odd]);
    expect(out[1].text).toBe("바다가 보이는 곳");
  });

  it("normalizeScript를 통과하면 자동 적용된다", () => {
    const out = normalizeScript(
      [
        { text: "수영장이 펼쳐진답니다", parts: [{ cut: 1, text: "수영장이 펼쳐진답니다" }] },
        { text: "바다가 보인답니다", parts: [{ cut: 2, text: "바다가 보인답니다" }] },
      ],
      2
    );
    expect(out[1].text).not.toContain("답니다");
  });
});

// ── 절 사이 쉼 (테오 2026-07-23: "잠시 쉬고가 없이 다음 문맥이 나오니 이상해") ──
describe("buildSpeechMarkup — 절 경계에 쉼 태그를 넣는다", () => {
  it("절 경계(쉼표·연결어미)에서 태그가 들어간다", () => {
    const [markup, pauses] = buildSpeechMarkup({
      text: "안방이 있고, 욕실까지 편안해요",
      parts: [
        { clipIndexes: [0], text: "안방이 있고," },
        { clipIndexes: [1], text: "욕실까지 편안해요" },
      ],
    });
    expect(markup).toBe("안방이 있고, [pause] 욕실까지 편안해요");
    expect(pauses).toEqual([PART_PAUSE_SEC, 0]);
    // 태그를 걷어내면 원래 문장과 같은 말이어야 한다(Gemini 폴백 경로가 그렇게 읽는다).
    expect(stripPauseTags(markup)).toBe("안방이 있고, 욕실까지 편안해요");
  });

  it("절이 하나면 태그를 넣지 않는다", () => {
    const [markup, pauses] = buildSpeechMarkup({
      text: "바다가 보여요",
      parts: [{ clipIndexes: [0], text: "바다가 보여요" }],
    });
    expect(markup).toBe("바다가 보여요");
    expect(pauses).toEqual([0]);
  });

  it("★ 구 한가운데서 끊긴 절 뒤에는 쉼을 넣지 않는다(테오 지적 재발 방지)", () => {
    // 자막 절은 글자수로 나뉘어 "…은은한 대리석 / 세면대 욕실과…"처럼 구 중간에서 끊길 수 있다.
    // 거기 0.69초를 넣으면 쉼이 없던 것보다 더 이상하게 들린다.
    const [markup, pauses] = buildSpeechMarkup({
      text: "첫 번째 방에는 은은한 대리석 세면대 욕실이 있죠",
      parts: [
        { clipIndexes: [0], text: "첫 번째 방에는 은은한 대리석" },
        { clipIndexes: [1], text: "세면대 욕실이 있죠" },
      ],
    });
    expect(markup).not.toContain("[pause]");
    expect(pauses).toEqual([0, 0]);
  });

  it("★ 절을 이어 붙인 게 문장과 다르면 태그 없이 원문을 쓴다(말이 바뀌면 안 된다)", () => {
    const [markup, pauses] = buildSpeechMarkup({
      text: "안방이 있고, 욕실까지 편안해요",
      parts: [
        { clipIndexes: [0], text: "안방이 있고," },
        { clipIndexes: [1], text: "전혀 다른 말" },
      ],
    });
    // 절 정합이 깨졌으므로 절별 배분은 포기하되(0), 말 자체는 문장 원문 그대로여야 한다.
    expect(stripPauseTags(markup)).toBe("안방이 있고, 욕실까지 편안해요");
    expect(pauses.every((p) => p === 0)).toBe(true);
  });

  it("★ 절 안쪽 쉼표에서도 쉰다 (테오 2차 지적: 쉼표에서 안 쉬어 어색하다)", () => {
    const [markup, pauses] = buildSpeechMarkup({
      text: "이제 일 층으로 가면, 대리석 세면대 욕실이 있고, 통창 너머 수영장이 보여요",
      parts: [
        { clipIndexes: [0], text: "이제 일 층으로 가면, 대리석 세면대 욕실이 있고," },
        { clipIndexes: [1], text: "통창 너머 수영장이 보여요" },
      ],
    });
    // 절 안쪽 '가면,'과 절 경계 '있고,' 두 곳 모두 쉰다
    expect(markup).toBe("이제 일 층으로 가면, [pause] 대리석 세면대 욕실이 있고, [pause] 통창 너머 수영장이 보여요");
    expect(pauses).toEqual([PART_PAUSE_SEC * 2, 0]);
  });

  it("쉼이 너무 촘촘하면 건너뛴다(딱딱해지지 않게)", () => {
    const [markup] = buildSpeechMarkup({
      text: "침대와, 티브이가 있어 휴식을 취하기 좋구요",
      parts: [
        { clipIndexes: [0], text: "침대와, 티브이가 있어" },
        { clipIndexes: [1], text: "휴식을 취하기 좋구요" },
      ],
    });
    // '침대와,' 앞은 네 글자뿐 → 쉼 없음
    expect(markup.startsWith("침대와, 티브이가")).toBe(true);
  });
});

describe("computeNarrationTimeline — 쉼은 앞 절이 화면을 지킨다", () => {
  const parts = [
    { clipIndexes: [0], text: "가나다라" },
    { clipIndexes: [1], text: "마바사아" },
  ];

  it("쉼 시간이 앞 컷에 얹히고 총 길이는 보존된다", () => {
    const common = { transitionSec: 0.4, minSegmentSec: 0.1, ctaMinSec: 2.8 };
    const withPause = computeNarrationTimeline({
      lines: [{ durationSec: 4 + PART_PAUSE_SEC, pauseSecByPart: [PART_PAUSE_SEC, 0], parts }],
      ...common,
    });
    const noPause = computeNarrationTimeline({
      lines: [{ durationSec: 4 + PART_PAUSE_SEC, parts }],
      ...common,
    });
    // 쉼을 알면 앞 컷이 그만큼 더 오래 화면을 지킨다(쉼 동안 다음 컷으로 넘어가면 안 된다).
    const gapWith = withPause.clipDurations[0] - withPause.clipDurations[1];
    const gapWithout = noPause.clipDurations[0] - noPause.clipDurations[1];
    expect(gapWith - gapWithout).toBeCloseTo(PART_PAUSE_SEC, 5);
    // 총 길이는 두 경우가 같아야 한다(쉼도 결국 화면 시간이다).
    expect(withPause.totalSec).toBeCloseTo(noPause.totalSec, 5);
  });
});

// ── 빌라 이름 한글 읽기 (테오 2026-07-23: 대본에 "M villa M1"이 섞여 TTS가 어색하게 읽음) ──
describe("toKoreanReading — 이름은 소리 나는 대로 한글", () => {
  it("영문 빌라명을 한글 읽기로 바꾼다", () => {
    expect(toKoreanReading("M villa M1")).toBe("엠 빌라 엠일");
    expect(toKoreanReading("Sonasea V01")).toBe("소나시 브이공일");
    expect(toKoreanReading("The Ocean House")).toBe("오션 하우스");
  });

  it("이미 한글이면 그대로 둔다", () => {
    expect(toKoreanReading("엠빌라 엠원")).toBe("엠빌라 엠원");
  });

  it("결과에 영문·숫자가 남지 않는다(대본 규칙과 같은 기준)", () => {
    for (const n of ["M villa M1", "Sonasea V01", "Sunset Sanato B12", "Greenbay 7"]) {
      expect(/[0-9A-Za-z]/.test(toKoreanReading(n))).toBe(false);
    }
  });
});
