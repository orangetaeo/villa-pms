// lib/youtube/cut-planner.ts — 워크스루 원본 → 컷 표 자동 설계 (video-production 자동화)
//
// 왜 만들었나(테오 2026-07-23): M villa M1 한 편을 만드는 데 컷 표를 사람이 손으로 골랐고,
//   그 과정에서 **변기 4건·화면 중복 1건·피사체 누락 2건**이 나와 재생성을 다섯 번 했다.
//   다음 빌라는 원본이 다르므로 그 노동이 매번 반복된다 — 그래서 **고르는 일 자체를 자동화**한다.
//
// 입력: 원본 영상을 일정 간격으로 샘플링한 프레임 판정(공간·피사체·문제)
// 출력: 컷 표(label·src·len·pace·space·note) — smoke/scripts가 그대로 재단할 수 있는 형태
//
// ★ 이 파일은 **순수 함수만** 둔다(테스트로 규칙을 고정). Vision 호출·ffmpeg는 호출부가 한다.
//   실측에서 나온 규칙 세 가지가 여기 박혀 있다:
//     ⑴ 화면에 나가는 건 앞 3~4초 → 컷은 **문제 없는 4초 창**에서만 시작한다
//     ⑵ 이동 컷은 원본을 1.9×1.85≈3.5초까지 읽는다 → **끝이 다음 컷 시작을 넘지 않게** 자른다
//     ⑶ 변기·촬영자·쓰레기통이 잡히는 구간은 통째로 피한다(검수가 어차피 렌더를 막는다)
import { SPACE_LABEL } from "@/lib/youtube/clip-audit";

/** 이동 컷이 원본을 읽는 최대 길이(초) = maxScreenSecFor(transit) × PACE_SPEED.transit */
export const TRANSIT_MAX_READ_SEC = 1.9 * 1.85;
/** 보여주는 컷이 실제로 화면에 나가는 최대 길이(초) — 검수 창과 같은 근거(앞 4초). */
export const FEATURE_WINDOW_SEC = 4;

export interface FrameVerdict {
  /** 원본에서의 시각(초) */
  atSec: number;
  /** 이 프레임에 보이는 공간(PhotoSpace). 판정 불가면 null */
  space: string | null;
  /** 한 줄 요약(그대로 note 후보가 된다) */
  summary: string;
  /** 홍보에 나가면 곤란한 것(변기·쓰레기통·촬영자·사람 얼굴 등). 없으면 빈 배열 */
  problems: string[];
}

export interface PlannedCut {
  label: string;
  src: number;
  len: number;
  pace: "fast" | "slow";
  space: string;
  note: string;
}

export interface PlanOptions {
  /** 샘플 간격(초) — 판정 배열의 간격과 같아야 한다 */
  stepSec: number;
  /** 만들 컷 수 상한(edit.ts CLIP_COUNT_MAX와 같은 30) */
  maxCuts?: number;
  /** 보여주는 컷의 기본 길이(초) */
  featureLenSec?: number;
  /** 이동 컷을 넣을 최소 간격(초) — 두 공간 사이가 이보다 멀면 이동 컷을 하나 넣는다 */
  transitMinGapSec?: number;
}

/** 문제 프레임인가 — 하나라도 문제가 적히면 그 구간은 쓰지 않는다. */
function isDirty(v: FrameVerdict): boolean {
  return v.problems.length > 0;
}

/**
 * 같은 공간이 연속되는 구간(run)으로 묶는다. 문제 프레임은 구간을 끊는다.
 * ETC(복도·계단)는 "보여주는 공간"이 아니므로 별도로 표시한다.
 */
interface Run {
  space: string;
  fromSec: number;
  toSec: number;
  /** 이 구간에서 가장 설명이 긴 요약 — note 후보 */
  note: string;
}

export function buildRuns(verdicts: FrameVerdict[], stepSec: number): Run[] {
  const runs: Run[] = [];
  for (const v of verdicts) {
    if (!v.space || isDirty(v)) continue; // 공간 미상·문제 프레임은 구간에 넣지 않는다
    const last = runs[runs.length - 1];
    if (last && last.space === v.space && v.atSec - last.toSec <= stepSec + 1e-6) {
      last.toSec = v.atSec;
      if (v.summary.length > last.note.length) last.note = v.summary;
    } else {
      runs.push({ space: v.space, fromSec: v.atSec, toSec: v.atSec, note: v.summary });
    }
  }
  return runs;
}

/** 라벨 만들기 — 같은 이름이 여러 번 나오면 번호를 붙인다(방이 여러 개인 빌라에서 필수). */
function labeler() {
  const seen = new Map<string, number>();
  return (base: string) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}${n}`;
  };
}

/** 초 단위는 소수점 한 자리로 — ffmpeg 인자에 부동소수 잡음(6.984999…)이 그대로 들어가지 않게. */
const r1 = (n: number) => Number(n.toFixed(1));

/**
 * 프레임 판정 → 컷 표.
 *
 * 규칙:
 *   - 보여주는 컷(slow)은 **깨끗한 구간이 4초 이상**일 때만 만든다(검수 창과 같은 기준).
 *   - 두 보여주는 컷 사이가 멀면 그 사이에 **이동 컷(fast)** 하나를 넣는다(투어 흐름).
 *   - 모든 컷은 `src + 읽는길이 ≤ 다음 컷 src`가 되도록 길이를 깎는다(화면 중복 방지).
 *   - 컷 수가 상한을 넘으면 **짧은 구간부터** 버린다(가장 볼 것 없는 컷이 먼저 빠진다).
 */
export function planCuts(verdicts: FrameVerdict[], opts: PlanOptions): PlannedCut[] {
  const step = opts.stepSec;
  const maxCuts = opts.maxCuts ?? 30;
  const featureLen = opts.featureLenSec ?? 6;
  const transitGap = opts.transitMinGapSec ?? 6;

  const runs = buildRuns(verdicts, step).filter((r) => r.toSec - r.fromSec >= FEATURE_WINDOW_SEC - step);

  // ETC는 이동 컷 재료, 나머지는 보여주는 컷 재료.
  const features = runs.filter((r) => r.space !== "ETC");
  const transits = runs.filter((r) => r.space === "ETC");

  // 컷 수 상한 — 짧은 구간부터 버린다(길이 = 그 공간을 얼마나 오래 비췄나 = 중요도 근사).
  const kept = [...features]
    .sort((a, b) => b.toSec - b.fromSec - (a.toSec - a.fromSec))
    .slice(0, Math.max(1, Math.floor(maxCuts / 2)))
    .sort((a, b) => a.fromSec - b.fromSec);

  const label = labeler();
  const cuts: PlannedCut[] = [];
  for (let i = 0; i < kept.length; i++) {
    const r = kept[i];
    // 이동 컷 — 앞 컷과 이 컷 사이에 ETC 구간이 있고 간격이 충분하면 하나 넣는다.
    const prevEnd = cuts.length ? cuts[cuts.length - 1].src + cuts[cuts.length - 1].len : 0;
    const gapStart = Math.max(prevEnd, cuts.length ? cuts[cuts.length - 1].src : 0);
    if (r.fromSec - gapStart >= transitGap) {
      const t = transits.find((x) => x.fromSec >= gapStart && x.toSec <= r.fromSec);
      const src = t ? t.fromSec : Math.max(gapStart, r.fromSec - TRANSIT_MAX_READ_SEC);
      if (src + 1 <= r.fromSec) {
        cuts.push({
          label: label(`to-${(r.space ?? "etc").toLowerCase()}`),
          src: r1(src),
          len: r1(Math.min(TRANSIT_MAX_READ_SEC, r.fromSec - src)),
          pace: "fast",
          space: "ETC",
          note: t?.note ?? `${SPACE_LABEL[r.space] ?? r.space}(으)로 이동`,
        });
      }
    }
    cuts.push({
      label: label(r.space.toLowerCase()),
      src: r1(r.fromSec),
      len: r1(Math.min(featureLen, r.toSec - r.fromSec + step)),
      pace: "slow",
      space: r.space,
      note: r.note,
    });
  }

  return trimOverlaps(cuts).slice(0, maxCuts);
}

/**
 * **화면 중복 방지** — 각 컷이 읽을 수 있는 마지막 지점이 다음 컷 시작을 넘지 않게 길이를 깎는다.
 * (테오 2026-07-23 "26~27초에 영상이 중복된다"의 구조적 원인)
 */
export function trimOverlaps(cuts: PlannedCut[]): PlannedCut[] {
  const out = cuts.map((c) => ({ ...c })).sort((a, b) => a.src - b.src);
  for (let i = 0; i < out.length - 1; i++) {
    const c = out[i];
    const next = out[i + 1];
    const maxRead = c.pace === "fast" ? Math.min(c.len, TRANSIT_MAX_READ_SEC) : c.len;
    if (c.src + maxRead > next.src) {
      c.len = Math.max(0, Number((next.src - c.src).toFixed(1)));
    }
  }
  // 너무 짧아진 컷은 버린다(2초 미만은 edit.ts CLIP_DUR_MIN 아래).
  return out.filter((c) => c.len >= 2);
}

/** 컷 표 → 사람이 읽는 마크다운 표(스토리보드 문서에 그대로 붙인다). */
export function cutsToMarkdown(cuts: PlannedCut[]): string {
  const head = "| # | label | src | len | pace | space | note |\n|---|---|---|---|---|---|---|";
  const rows = cuts.map(
    (c, i) =>
      `| ${i + 1} | ${c.label} | ${c.src} | ${c.len} | ${c.pace} | ${c.space} | ${c.note.replace(/\|/g, "/")} |`
  );
  return [head, ...rows].join("\n");
}
