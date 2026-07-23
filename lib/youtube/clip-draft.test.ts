import { describe, expect, it } from "vitest";
import {
  orderClipsForTour,
  canBuildTour,
  buildTourHeadline,
  buildTourEditParams,
  usableTourClips,
  MIN_CLIPS_FOR_TOUR,
  MAX_CLIPS_FOR_TOUR,
  type ClipRow,
} from "./clip-draft";

const clip = (space: string | null, at: number, note: string | null = null, durationSec = 8): ClipRow => ({
  id: `c${at}`,
  r2Key: `villa-clips/${"a".repeat(8)}${at}.mp4`,
  space,
  note,
  durationSec,
  createdAt: new Date(2026, 0, 1, 0, 0, at),
});

describe("orderClipsForTour — 둘러보는 동선대로", () => {
  it("밖 → 수영장 → 이동 → 실내 → 침실 → 욕실 → 베란다 순으로 정렬한다", () => {
    const out = orderClipsForTour([
      clip("BALCONY", 1),
      clip("LIVING", 2),
      clip("EXTERIOR", 3),
      clip("BEDROOM", 4),
      clip("POOL", 5),
      clip("ETC", 6),
    ]);
    expect(out.map((c) => c.space)).toEqual(["EXTERIOR", "POOL", "ETC", "LIVING", "BEDROOM", "BALCONY"]);
  });

  it("같은 공간끼리는 올린 순서를 지킨다(방 번호 순인 경우가 많다)", () => {
    const out = orderClipsForTour([clip("BEDROOM", 9), clip("BEDROOM", 3), clip("BEDROOM", 6)]);
    expect(out.map((c) => c.id)).toEqual(["c3", "c6", "c9"]);
  });

  it("공간 미지정은 맨 뒤로 밀린다", () => {
    const out = orderClipsForTour([clip(null, 1), clip("LIVING", 2)]);
    expect(out[0].space).toBe("LIVING");
  });
});

describe("canBuildTour — 영상 기반으로 갈지 판정", () => {
  it(`클립이 ${MIN_CLIPS_FOR_TOUR}개 미만이면 사진 슬라이드쇼로 폴백한다`, () => {
    expect(canBuildTour([clip("LIVING", 1), clip("POOL", 2)])).toBe(false);
    expect(canBuildTour([clip("LIVING", 1), clip("POOL", 2), clip("BEDROOM", 3)])).toBe(true);
  });
});

describe("buildTourHeadline", () => {
  it("해변이 가까우면 그 사실이 첫 줄", () => {
    expect(buildTourHeadline({ name: "M villa M1", bedrooms: 4, hasPool: true, beachDistanceM: 100 })).toBe(
      "해변 바로 앞\n침실 4개 프라이빗 풀빌라"
    );
  });

  it("해변이 멀면 빌라 이름을 쓴다", () => {
    expect(buildTourHeadline({ name: "그린베이", bedrooms: 2, hasPool: false, beachDistanceM: 3000 })).toBe(
      "그린베이\n침실 2개"
    );
  });
});

describe("buildTourEditParams — 렌더 파라미터", () => {
  const clips = [clip("EXTERIOR", 1), clip("LIVING", 2, "거실"), clip("BEDROOM", 3)];
  const facts = { name: "엠빌라", bedrooms: 4, hasPool: true, beachDistanceM: 100 };

  it("★ 검수·완급·배경음이 켜진 채로 나간다(자동 생성물에도 같은 게이트)", () => {
    const p = buildTourEditParams("v1", facts, clips);
    expect(p.audit).toBe(true);
    expect(p.pacing).toBe(true);
    expect(p.bgm).toBe("soft");
    expect(p.audio).toBe("silent"); // 나레이션이 대신한다
  });

  it("클립은 투어 순서로, 공간·메모를 함께 싣는다(대본·완급 판정 근거)", () => {
    const p = buildTourEditParams("v1", facts, [clips[2], clips[0], clips[1]]);
    expect(p.clips.map((c) => c.space)).toEqual(["EXTERIOR", "LIVING", "BEDROOM"]);
    expect(p.clips[1].note).toBe("거실");
    expect(p.clips[0].key.startsWith("villa-clips/")).toBe(true);
  });

  it("길이는 2~8초로 묶는다(렌더가 나레이션에 맞춰 다시 정한다)", () => {
    // 15초 클립은 쓰되 화면 상한 8초로, 1초 클립은 하한 2초로 묶인다.
    const p = buildTourEditParams("v1", facts, [clip("POOL", 1, null, 15), clip("LIVING", 2, null, 1), clip("BEDROOM", 3)]);
    expect(p.clips.map((c) => c.durationSec)).toEqual([8, 2, 8]);
  });

  it(`클립이 아무리 많아도 ${MAX_CLIPS_FOR_TOUR}개까지만 쓴다`, () => {
    const many = Array.from({ length: 40 }, (_, i) => clip("BEDROOM", i));
    expect(buildTourEditParams("v1", facts, many).clips).toHaveLength(MAX_CLIPS_FOR_TOUR);
  });

  it("나레이션이 있으면 실어 보내고, 없으면 필드 자체가 없다", () => {
    const withN = buildTourEditParams("v1", facts, clips, [
      { text: "가나다", parts: [{ clipIndexes: [0], text: "가나다" }] },
    ]);
    expect(withN.narration?.lines).toHaveLength(1);
    expect(buildTourEditParams("v1", facts, clips).narration).toBeUndefined();
  });
});

describe("usableTourClips — 워크스루 원본은 자동 투어에 쓰지 않는다", () => {
  it("20초를 넘는 클립은 제외한다(앞 8초만 나가는 엉뚱한 컷 방지)", () => {
    const clips = [clip("EXTERIOR", 1, null, 540), clip("LIVING", 2, null, 8), clip("POOL", 3, null, 6)];
    expect(usableTourClips(clips).map((c) => c.durationSec)).toEqual([8, 6]);
  });

  it("긴 것을 뺀 뒤 개수가 모자라면 사진 슬라이드쇼로 폴백한다", () => {
    expect(canBuildTour([clip("EXTERIOR", 1, null, 540), clip("LIVING", 2, null, 8), clip("POOL", 3, null, 6)])).toBe(false);
  });
});
