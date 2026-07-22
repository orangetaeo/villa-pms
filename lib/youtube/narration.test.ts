import { describe, expect, it } from "vitest";
import {
  NARRATION_LEAD_SEC,
  NARRATION_TAIL_SEC,
  NARRATION_RULES,
  computeNarrationTimeline,
  normalizeScript,
  validateNarrationLines,
  type NarrationLine,
} from "./narration";
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
