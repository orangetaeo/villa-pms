import { describe, expect, it } from "vitest";
import {
  NARRATION_LEAD_SEC,
  NARRATION_PAD_SEC,
  NARRATION_RULES,
  SUBTITLE_TAIL_SEC,
  computeNarrationTimeline,
  validateNarrationLines,
  type NarrationLine,
} from "./narration";
import { pcmToWav, ttsCacheKey, wavDurationSec } from "../gemini-tts";

// edit.ts 상수와 같은 값 — 타임라인이 실제 렌더 파라미터와 정합해야 의미가 있다.
const T = 0.4; // TRANSITION_SEC
const MIN_SEG = 2; // CLIP_DUR_MIN
const CTA_MIN = 2.8; // CTA_DUR_SEC

const base = { transitionSec: T, minSegmentSec: MIN_SEG, ctaMinSec: CTA_MIN };

describe("computeNarrationTimeline", () => {
  it("세그먼트 길이 = 문장 길이 + PAD (하한 미만이면 하한)", () => {
    const r = computeNarrationTimeline({ lineDurations: [2.5, 3.0, 2.0], ...base });
    expect(r.segmentDurations[0]).toBeCloseTo(2.5 + NARRATION_PAD_SEC, 5);
    expect(r.segmentDurations[1]).toBeCloseTo(3.0 + NARRATION_PAD_SEC, 5);
    // 마지막은 CTA — max(2.8, 2.0+0.6=2.6) = 2.8
    expect(r.segmentDurations[2]).toBeCloseTo(CTA_MIN, 5);
  });

  it("짧은 문장도 CLIP_DUR_MIN 이상 세그먼트를 받는다 (C3)", () => {
    const r = computeNarrationTimeline({ lineDurations: [0.5, 0.5, 0.5], ...base });
    expect(r.segmentDurations[0]).toBe(MIN_SEG); // 0.5+0.6=1.1 < 2 → 하한
    expect(r.segmentDurations[1]).toBe(MIN_SEG);
    expect(r.segmentDurations[2]).toBe(CTA_MIN);
  });

  it("오프셋은 xfade 겹침(T)을 빼고 누적한다 — 단순 Σdur가 아니다 (C1)", () => {
    const r = computeNarrationTimeline({ lineDurations: [2.5, 3.0, 2.0], ...base });
    const [d0, d1] = r.segmentDurations;
    expect(r.lineOffsets[0]).toBeCloseTo(NARRATION_LEAD_SEC, 5);
    expect(r.lineOffsets[1]).toBeCloseTo(d0 - T + NARRATION_LEAD_SEC, 5);
    expect(r.lineOffsets[2]).toBeCloseTo(d0 - T + (d1 - T) + NARRATION_LEAD_SEC, 5);
  });

  it("총 길이 = Σdur − (n−1)·T", () => {
    const r = computeNarrationTimeline({ lineDurations: [2.5, 3.0, 2.0], ...base });
    const sum = r.segmentDurations.reduce((a, b) => a + b, 0);
    expect(r.totalSec).toBeCloseTo(sum - 2 * T, 5);
  });

  it("자막 구간은 나레이션 시작에 맞고 말끝보다 조금 길다", () => {
    const durs = [2.5, 3.0, 2.0];
    const r = computeNarrationTimeline({ lineDurations: durs, ...base });
    r.subtitleRanges.forEach((s, i) => {
      expect(s.fromSec).toBeCloseTo(r.lineOffsets[i], 5);
      expect(s.toSec).toBeGreaterThan(s.fromSec);
      // 총 길이로 클램프되지 않은 구간은 정확히 말끝 + TAIL
      if (r.lineOffsets[i] + durs[i] + SUBTITLE_TAIL_SEC <= r.totalSec) {
        expect(s.toSec).toBeCloseTo(r.lineOffsets[i] + durs[i] + SUBTITLE_TAIL_SEC, 5);
      }
    });
  });

  it("마지막 자막은 영상 길이를 넘지 않는다", () => {
    const r = computeNarrationTimeline({ lineDurations: [2.5, 3.0, 2.6], ...base });
    const last = r.subtitleRanges[r.subtitleRanges.length - 1];
    expect(last.toSec).toBeLessThanOrEqual(r.totalSec + 1e-9);
  });

  it("15초 목표: 4문장 × 2.4초면 대략 15초에 안착한다", () => {
    const r = computeNarrationTimeline({ lineDurations: [2.4, 2.4, 2.4, 2.4], ...base });
    expect(r.totalSec).toBeGreaterThan(9);
    expect(r.totalSec).toBeLessThan(15);
  });

  it("문장 1개(엣지)도 계산된다 — n−1=0이라 전환 차감 없음", () => {
    const r = computeNarrationTimeline({ lineDurations: [3.0], ...base });
    expect(r.segmentDurations).toHaveLength(1);
    expect(r.totalSec).toBeCloseTo(r.segmentDurations[0], 5);
    expect(r.lineOffsets[0]).toBeCloseTo(NARRATION_LEAD_SEC, 5);
  });
});

describe("validateNarrationLines", () => {
  const line = (text: string): NarrationLine => ({ text, clipIndex: 0 });

  it("규칙을 지킨 대본은 통과", () => {
    const r = validateNarrationLines([
      line("푸꾸옥 바다가 보이는 집이에요"),
      line("침실은 모두 오션뷰예요"),
      line("수영장은 우리 가족만 써요"),
      line("카카오톡에서 빌라고를 찾으세요"),
    ]);
    expect(r.ok).toBe(true);
    expect(r.lineIssues.every((i) => i === null)).toBe(true);
  });

  it("숫자·영문이 들어가면 거부 — TTS가 이상하게 읽는다 (C6)", () => {
    const r = validateNarrationLines([
      line("침실이 3개 있는 집이에요"),
      line("소나시 V열두동 빌라예요"),
      line("카카오톡에서 빌라고를 찾으세요"),
    ]);
    expect(r.ok).toBe(false);
    expect(r.lineIssues[0]).toBe("HAS_DIGIT_OR_LATIN");
    expect(r.lineIssues[1]).toBe("HAS_DIGIT_OR_LATIN");
    expect(r.lineIssues[2]).toBeNull();
  });

  it("18자를 넘으면 TOO_LONG — 15초에 안 들어간다", () => {
    const over = "가".repeat(NARRATION_RULES.maxChars + 1);
    const r = validateNarrationLines([line(over), line("괜찮은 문장이에요"), line("또 괜찮은 문장이에요")]);
    expect(r.lineIssues[0]).toBe("TOO_LONG");
    expect(r.ok).toBe(false);
  });

  it("경계값(최대 글자수 정확히)은 통과", () => {
    const exact = "가".repeat(NARRATION_RULES.maxChars);
    const r = validateNarrationLines([line(exact), line("괜찮은 문장이에요"), line("또 괜찮은 문장이에요")]);
    expect(r.lineIssues[0]).toBeNull();
  });

  it("빈 문장·너무 짧은 문장 구분", () => {
    const r = validateNarrationLines([line("   "), line("짧아요"), line("괜찮은 문장이에요")]);
    expect(r.lineIssues[0]).toBe("EMPTY");
    expect(r.lineIssues[1]).toBe("TOO_SHORT");
  });

  it("문장 수가 범위 밖이면 대본 수준 문제로 잡힌다", () => {
    const ok = line("괜찮은 문장이에요");
    expect(validateNarrationLines([ok, ok]).scriptIssues).toContain("TOO_FEW_LINES");
    expect(
      validateNarrationLines([ok, ok, ok, ok, ok, ok]).scriptIssues
    ).toContain("TOO_MANY_LINES");
  });
});

describe("gemini-tts WAV 유틸", () => {
  it("pcmToWav는 44바이트 RIFF 헤더를 붙인다", () => {
    const pcm = Buffer.alloc(48_000); // 24kHz mono 16bit → 1초
    const wav = pcmToWav(pcm);
    expect(wav.length).toBe(pcm.length + 44);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24_000); // sampleRate
    expect(wav.readUInt16LE(22)).toBe(1); // mono
  });

  it("wavDurationSec는 ffprobe 없이 길이를 계산한다", () => {
    expect(wavDurationSec(pcmToWav(Buffer.alloc(48_000)))).toBeCloseTo(1.0, 6);
    expect(wavDurationSec(pcmToWav(Buffer.alloc(24_000)))).toBeCloseTo(0.5, 6);
  });

  it("캐시 키는 문장·목소리·모델에 모두 반응한다 (C4)", () => {
    const a = ttsCacheKey("안녕하세요", "Kore", "m1");
    expect(ttsCacheKey("안녕하세요", "Kore", "m1")).toBe(a); // 동일 입력 → 동일 키
    expect(ttsCacheKey("안녕하세요!", "Kore", "m1")).not.toBe(a);
    expect(ttsCacheKey("안녕하세요", "Puck", "m1")).not.toBe(a);
    expect(ttsCacheKey("안녕하세요", "Kore", "m2")).not.toBe(a);
  });
});
