// 빌라당 콘텐츠 상한 게이트(per-villa-content-cap) — isRotationEligible 순수함수.
//
// 배경: 빌라가 2곳뿐인데 매일 인스타 3건·쇼츠 1건이 생성돼 같은 빌라가 도배됐다(2026-07-23).
//   상한(기본 1)에 도달한 빌라는 후보에서 빠지고, 상한을 올리면 다시 후보가 되어야 한다.
import { describe, it, expect } from "vitest";
import { isRotationEligible, MIN_ROTATION_PHOTOS } from "@/lib/instagram/draft";
import { IG_POSTS_PER_VILLA_DEFAULT } from "@/lib/instagram/settings";
import { YT_SHORTS_PER_VILLA_DEFAULT } from "@/lib/youtube/settings";

describe("isRotationEligible — 빌라당 콘텐츠 상한", () => {
  it("콘텐츠가 하나도 없는 빌라는 후보다", () => {
    expect(isRotationEligible(8, 0, 1)).toBe(true);
  });

  it("상한 1에 이미 1건이 있으면 제외한다 (같은 빌라 도배 방지의 핵심)", () => {
    expect(isRotationEligible(8, 1, 1)).toBe(false);
  });

  it("상한을 넘겨 이미 여러 건이 있어도 당연히 제외한다", () => {
    expect(isRotationEligible(13, 3, 1)).toBe(false);
  });

  it("상한을 2로 올리면 1건 있는 빌라가 다시 후보가 된다 (빌라 늘면 운영자가 조절)", () => {
    expect(isRotationEligible(8, 1, 2)).toBe(true);
    expect(isRotationEligible(8, 2, 2)).toBe(false);
  });

  it("상한 0이면 어떤 빌라도 후보가 아니다 (자동 생성 완전 중단 스위치)", () => {
    expect(isRotationEligible(20, 0, 0)).toBe(false);
  });

  it("음수 상한도 중단으로 취급한다", () => {
    expect(isRotationEligible(20, 0, -1)).toBe(false);
  });

  it("사진이 최소 장수에 못 미치면 상한과 무관하게 제외한다", () => {
    expect(isRotationEligible(MIN_ROTATION_PHOTOS - 1, 0, 5)).toBe(false);
    expect(isRotationEligible(MIN_ROTATION_PHOTOS, 0, 5)).toBe(true);
  });

  it("기본 상한은 인스타·유튜브 모두 1이다 (미설정 시 빌라당 1개)", () => {
    expect(IG_POSTS_PER_VILLA_DEFAULT).toBe(1);
    expect(YT_SHORTS_PER_VILLA_DEFAULT).toBe(1);
    // 기본값 그대로면 콘텐츠 1건 보유 빌라는 후보에서 빠진다.
    expect(isRotationEligible(8, 1, IG_POSTS_PER_VILLA_DEFAULT)).toBe(false);
    expect(isRotationEligible(8, 1, YT_SHORTS_PER_VILLA_DEFAULT)).toBe(false);
  });
});
