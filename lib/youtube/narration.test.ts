import { describe, expect, it } from "vitest";
import {
  NARRATION_LEAD_SEC,
  NARRATION_TAIL_SEC,
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

/**
 * ★ 이 파일에서 가장 중요한 불변식(2026-07-22 실측 결함):
 *   문장 i의 발화는 **다음 컷으로 넘어가는 전환이 시작되기 전에** 끝나야 한다.
 *   초기 구현은 여유를 전환과 무관한 상수(0.6)로 잡아 말이 끝나기 0.05초 전에 화면이 넘어갔다.
 *   → "화면이 지나갔는데 나레이션이 늦게 끝난다".
 *
 * xfadeConcat 기준: 세그먼트 i로 들어가는 전환 시작 A_i = Σ_{j<i}(dur_j − T),
 *   다음 전환 시작 = A_i + dur_i − T.
 */
function transitionStarts(segs: number[], T: number): number[] {
  const A: number[] = [];
  let acc = 0;
  for (const d of segs) {
    A.push(acc);
    acc += d - T;
  }
  return A;
}

describe("computeNarrationTimeline — 발화가 장면 전환보다 먼저 끝난다 (핵심 불변식)", () => {
  const cases: number[][] = [
    [2.5, 3.0, 2.0],
    [0.5, 0.5, 0.5],
    [4.69, 3.25, 4.13, 3.53, 2.21],
    [3.61, 3.93, 4.01, 4.09, 4.25, 3.81, 4.25, 3.25, 4.13, 3.53, 4.69, 3.29], // 실제 투어 대본
  ];

  it.each(cases)("문장 길이 %#: 모든 문장이 다음 전환 시작 전에 끝난다", (...lineDurations) => {
    const durs = lineDurations as number[];
    const r = computeNarrationTimeline({ lineDurations: durs, ...base });
    const A = transitionStarts(r.segmentDurations, T);

    const last = durs.length - 1;
    r.lineOffsets.forEach((off, i) => {
      const speechEnd = off + durs[i];
      // 마지막 세그먼트는 나가는 전환이 없다 — 상한은 영상의 끝(A+dur = totalSec).
      const deadline =
        i === last ? r.totalSec : A[i] + r.segmentDurations[i] - T;
      // 말끝 + TAIL 여유가 전환 시작(또는 영상 끝)보다 앞서야 한다
      expect(speechEnd + NARRATION_TAIL_SEC).toBeLessThanOrEqual(deadline + 1e-9);
    });
  });

  it.each(cases)("문장 길이 %#: 화면이 온전히 보인 뒤에 발화가 시작된다", (...lineDurations) => {
    const durs = lineDurations as number[];
    const r = computeNarrationTimeline({ lineDurations: durs, ...base });
    const A = transitionStarts(r.segmentDurations, T);

    r.lineOffsets.forEach((off, i) => {
      // 들어오는 전환이 끝난 시각(첫 컷은 0) 이후여야 한다
      const fullyVisibleAt = i === 0 ? 0 : A[i] + T;
      expect(off).toBeGreaterThanOrEqual(fullyVisibleAt - 1e-9);
    });
  });

  it("마지막 문장(CTA)은 영상 끝을 넘지 않는다", () => {
    const durs = [3.6, 4.0, 3.3];
    const r = computeNarrationTimeline({ lineDurations: durs, ...base });
    const lastEnd = r.lineOffsets[durs.length - 1] + durs[durs.length - 1];
    expect(lastEnd).toBeLessThanOrEqual(r.totalSec + 1e-9);
  });
});

describe("computeNarrationTimeline", () => {
  it("세그먼트 길이 = 전환 + 리드 + 발화 + 테일 + 전환 (하한 미만이면 하한)", () => {
    const r = computeNarrationTimeline({ lineDurations: [2.5, 3.0, 2.0], ...base });
    // 첫 컷: 들어오는 전환 없음 → 0 + LEAD + 2.5 + TAIL + T
    expect(r.segmentDurations[0]).toBeCloseTo(
      NARRATION_LEAD_SEC + 2.5 + NARRATION_TAIL_SEC + T,
      5
    );
    // 중간 컷: 양쪽 전환 모두
    expect(r.segmentDurations[1]).toBeCloseTo(
      T + NARRATION_LEAD_SEC + 3.0 + NARRATION_TAIL_SEC + T,
      5
    );
    // 마지막(CTA): 나가는 전환 없음
    expect(r.segmentDurations[2]).toBeCloseTo(
      T + NARRATION_LEAD_SEC + 2.0 + NARRATION_TAIL_SEC,
      5
    );
  });

  it("짧은 문장도 CLIP_DUR_MIN 이상 세그먼트를 받는다 (C3)", () => {
    const r = computeNarrationTimeline({ lineDurations: [0.5, 0.5, 0.5], ...base });
    expect(r.segmentDurations[0]).toBe(MIN_SEG); // 0.5+0.6=1.1 < 2 → 하한
    expect(r.segmentDurations[1]).toBe(MIN_SEG);
    expect(r.segmentDurations[2]).toBe(CTA_MIN);
  });

  it("오프셋은 xfade 겹침(T)을 빼고 누적하되, 들어오는 전환이 끝난 뒤부터 발화한다 (C1)", () => {
    const r = computeNarrationTimeline({ lineDurations: [2.5, 3.0, 2.0], ...base });
    const [d0, d1] = r.segmentDurations;
    // 첫 컷은 들어오는 전환이 없다
    expect(r.lineOffsets[0]).toBeCloseTo(NARRATION_LEAD_SEC, 5);
    // 이후 컷은 A_i + T(전환 완료) + LEAD 부터 — 전환 중에 말이 시작되면 이전 화면 위에 말이 얹힌다
    expect(r.lineOffsets[1]).toBeCloseTo(d0 - T + T + NARRATION_LEAD_SEC, 5);
    expect(r.lineOffsets[2]).toBeCloseTo(d0 - T + (d1 - T) + T + NARRATION_LEAD_SEC, 5);
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

  it("본문 문장이 상한을 넘으면 TOO_LONG — 자막 두 줄을 넘긴다", () => {
    // ★ 첫 자리에 두면 안 된다: 첫 문장은 훅이라 상한이 다르다(hookMaxChars).
    const over = "가".repeat(NARRATION_RULES.maxChars + 1);
    const r = validateNarrationLines([line("괜찮은 문장이에요"), line(over), line("또 괜찮은 문장이에요")]);
    expect(r.lineIssues[1]).toBe("TOO_LONG");
    expect(r.ok).toBe(false);
  });

  it("첫 문장(훅)만 더 긴 상한을 쓴다 — 이름+침실 수+수영장+해변을 한 문장에 담아야 한다", () => {
    // 일반 상한(32자)은 넘지만 훅 상한(48자) 이내인 문장
    const hook = "침실 세 개에 프라이빗 수영장, 문 열면 바로 해변인 엠빌라예요";
    expect(hook.length).toBeGreaterThan(NARRATION_RULES.maxChars);
    expect(hook.length).toBeLessThanOrEqual(NARRATION_RULES.hookMaxChars);

    // 첫 자리에 있으면 통과
    const ok = validateNarrationLines([
      line(hook),
      line("괜찮은 문장이에요"),
      line("또 괜찮은 문장이에요"),
    ]);
    expect(ok.lineIssues[0]).toBeNull();

    // 같은 문장이 두 번째 자리면 TOO_LONG — 훅 예외는 첫 문장에만 적용된다
    const notOk = validateNarrationLines([
      line("괜찮은 문장이에요"),
      line(hook),
      line("또 괜찮은 문장이에요"),
    ]);
    expect(notOk.lineIssues[1]).toBe("TOO_LONG");
  });

  it("훅 상한도 넘으면 첫 문장이라도 TOO_LONG", () => {
    const tooLong = "가".repeat(NARRATION_RULES.hookMaxChars + 1);
    const r = validateNarrationLines([line(tooLong), line("괜찮은 문장이에요"), line("또 괜찮은 문장이에요")]);
    expect(r.lineIssues[0]).toBe("TOO_LONG");
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
    // ★ 개수를 하드코딩하지 않는다 — NARRATION_RULES에서 파생한다.
    //   과거 6개를 TOO_MANY로 못박아뒀다가 maxLines 5→17 상향(투어 길이 확장) 때 깨졌다.
    const ok = line("괜찮은 문장이에요");
    const tooFew = Array.from({ length: NARRATION_RULES.minLines - 1 }, () => ok);
    const tooMany = Array.from({ length: NARRATION_RULES.maxLines + 1 }, () => ok);
    const justRight = Array.from({ length: NARRATION_RULES.maxLines }, () => ok);

    expect(validateNarrationLines(tooFew).scriptIssues).toContain("TOO_FEW_LINES");
    expect(validateNarrationLines(tooMany).scriptIssues).toContain("TOO_MANY_LINES");
    expect(validateNarrationLines(justRight).scriptIssues).toEqual([]); // 경계 상한은 통과
  });

  it("투어 길이 대본(11컷 + CTA)도 규칙을 통과한다 — 15초 공식에 갇히지 않는다", () => {
    const tour = [
      "푸꾸옥에서 만나는 특별한 휴식처입니다",
      "나만의 공간에서 즐기는 시원한 물놀이예요",
      "탁 트인 거실은 모두의 편안함을 선사해요",
      "필요한 모든 것을 갖춘 편리한 주방입니다",
      "안락한 침실은 편안한 밤을 선물합니다",
      "카카오톡에서 빌라고를 검색해 보세요",
    ].map(line);
    const r = validateNarrationLines(tour);
    expect(r.ok).toBe(true);
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
