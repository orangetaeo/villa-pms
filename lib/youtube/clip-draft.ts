// lib/youtube/clip-draft.ts — 자동 쇼츠를 **영상 기반**으로 (테오 2026-07-23)
//
// 왜(배경): 매일 도는 자동 쇼츠(cron:youtube-draft)는 **사진 슬라이드쇼**였다. 그래서 우리가 한 편을
//   손으로 다듬으며 얻은 것들 — 나레이션·쉼·완급·렌더 전 검수 — 이 **자동 생성물에는 하나도 적용되지 않았다.**
//   공급자가 올린 영상 클립(VillaClip)이 승인돼 있으면 그걸로 **투어 쇼츠**를 만드는 것이 맞다.
//
// 이 모듈이 하는 일(순수 함수 — 테스트로 규칙 고정):
//   ⑴ 승인 클립을 **투어 순서**로 정렬 (밖 → 수영장 → 들어가며 → 거실·주방 → 침실·욕실 → 베란다)
//   ⑵ 그 순서로 editParams(clips·headline·pacing·bgm·audit)를 만든다
//   ⑶ 영상 기반으로 갈지(클립 수 충족) 사진 슬라이드쇼로 갈지 판정한다
//
// ★ 렌더는 여기서 하지 않는다. `editJobStatus: PENDING`으로 넣어 두면 edit-jobs cron이
//   **검수 게이트를 통과한 뒤** 나레이션·완급까지 얹어 렌더한다(수동 경로와 완전히 같은 길).
import type { NarrationLine } from "@/lib/youtube/narration";

/** 투어 쇼츠로 만들 최소 클립 수. 이보다 적으면 사진 슬라이드쇼로 폴백한다. */
export const MIN_CLIPS_FOR_TOUR = 3;
/** 한 편에 쓸 최대 클립 수(edit.ts CLIP_COUNT_MAX와 동일). */
export const MAX_CLIPS_FOR_TOUR = 30;
/** 클립 하나가 화면을 점유할 상한(초) — edit.ts CLIP_DUR_MAX. 나레이션이 실제 길이를 다시 정한다. */
const CLIP_DUR_MAX = 8;
const CLIP_DUR_MIN = 2;

/**
 * 자동 투어에 쓸 수 있는 클립 길이 상한(초).
 *
 * ★ 왜 거르나: 이보다 긴 것은 사실상 **워크스루 원본**이다. 그걸 클립 하나로 쓰면 앞 8초만 나가
 *   "현관에서 시작해 아무 데도 안 가는" 컷이 된다. 워크스루는 컷 설계(scripts/plan-villa-cuts.mts)를
 *   거쳐야 하므로 자동 경로에서는 제외하고, 남은 짧은 클립으로만 만든다(모자라면 사진 폴백).
 */
export const MAX_CLIP_DURATION_SEC = 20;

/** 자동 투어 소재로 쓸 수 있는 클립만 남긴다(너무 긴 워크스루 제외). */
export function usableTourClips(clips: ClipRow[]): ClipRow[] {
  return clips.filter((c) => c.durationSec > 0 && c.durationSec <= MAX_CLIP_DURATION_SEC);
}

/**
 * 투어 순서 — 사람이 빌라를 둘러보는 동선 그대로.
 * ★ ETC(복도·계단)를 외부와 실내 사이에 두는 이유: 그게 실제로 "들어가는" 구간이고,
 *   페이싱이 이 컷만 빠르게 지나가게 만든다(pacing.ts transit).
 */
const TOUR_ORDER = ["EXTERIOR", "POOL", "ETC", "LIVING", "KITCHEN", "BEDROOM", "BATHROOM", "BALCONY"] as const;

export interface ClipRow {
  id: string;
  r2Key: string;
  space: string | null;
  note: string | null;
  durationSec: number;
  createdAt: Date;
}

/** 투어 순서로 정렬. 같은 공간끼리는 올린 순서를 유지한다(공급자가 찍은 순서 = 방 번호 순인 경우가 많다). */
export function orderClipsForTour(clips: ClipRow[]): ClipRow[] {
  const rank = (space: string | null) => {
    const i = TOUR_ORDER.indexOf((space ?? "") as (typeof TOUR_ORDER)[number]);
    return i < 0 ? TOUR_ORDER.length : i; // 공간 미지정은 맨 뒤
  };
  return [...clips].sort((a, b) => {
    const d = rank(a.space) - rank(b.space);
    return d !== 0 ? d : a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/** 영상 기반으로 만들 수 있나 — **쓸 수 있는** 승인 클립이 충분한가. */
export function canBuildTour(clips: ClipRow[]): boolean {
  return usableTourClips(clips).length >= MIN_CLIPS_FOR_TOUR;
}

export interface TourVillaFacts {
  name: string;
  bedrooms?: number | null;
  hasPool?: boolean;
  beachDistanceM?: number | null;
}

/**
 * 오프닝 헤드라인 — 화면에 뜨는 두 줄. 나레이션과 **같은 사실**을 음소거 시청자에게 전한다.
 * (수동 편에서 손으로 쓰던 "해변 바로 앞 / 네 침실 프라이빗 풀빌라"를 규칙으로 굳힌 것)
 */
export function buildTourHeadline(v: TourVillaFacts): string {
  const first =
    v.beachDistanceM != null && v.beachDistanceM <= 150
      ? "해변 바로 앞"
      : v.beachDistanceM != null && v.beachDistanceM <= 400
        ? "해변 도보 2분"
        : v.name;
  const parts: string[] = [];
  if (v.bedrooms) parts.push(`침실 ${v.bedrooms}개`);
  if (v.hasPool) parts.push("프라이빗 풀빌라");
  const second = parts.length ? parts.join(" ") : "푸꾸옥 빌라";
  return `${first}\n${second}`;
}

export interface TourEditParams {
  clips: { key: string; startSec: number; durationSec: number; space: string | null; note: string | null }[];
  headline: string;
  villaId: string;
  audio: "silent";
  horizontalMode: "crop";
  pacing: true;
  bgm: "soft";
  audit: true;
  narration?: { lines: NarrationLine[] };
}

/**
 * 승인 클립 + 빌라 사실 → editParams.
 * ★ `pace`는 넣지 않는다 — 공급자는 완급을 모른다. `resolveClipPace`가 공간·메모로 판정한다
 *   (ETC·"복도/계단" 메모는 이동 컷, 수영장·전망은 머무는 컷).
 */
export function buildTourEditParams(
  villaId: string,
  facts: TourVillaFacts,
  clips: ClipRow[],
  narrationLines?: NarrationLine[]
): TourEditParams {
  const ordered = orderClipsForTour(usableTourClips(clips)).slice(0, MAX_CLIPS_FOR_TOUR);
  return {
    clips: ordered.map((c) => ({
      key: c.r2Key,
      startSec: 0,
      // 나레이션 타임라인이 렌더 시 실제 길이를 다시 정한다 — 여기선 상·하한만 지킨다.
      durationSec: Math.min(CLIP_DUR_MAX, Math.max(CLIP_DUR_MIN, c.durationSec || CLIP_DUR_MAX)),
      space: c.space,
      note: c.note,
    })),
    headline: buildTourHeadline(facts),
    villaId,
    audio: "silent", // 나레이션이 대신한다(원본 소리는 쓰지 않는다)
    horizontalMode: "crop",
    pacing: true,
    bgm: "soft",
    audit: true, // ★ 렌더 전 검수 — 변기·촬영자가 잡히면 렌더가 멈춘다
    ...(narrationLines && narrationLines.length > 0 ? { narration: { lines: narrationLines } } : {}),
  };
}
