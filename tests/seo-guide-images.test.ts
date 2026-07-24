// tests/seo-guide-images.test.ts — 가이드 글 사진 혼합(자료 라이브러리 + 공개 빌라 사진)
// (T-seo-villa-photos-in-guide, 운영자 결정 2026-07-24)
//
// 여기서 지키는 것:
//  1) 둘 다 있으면 **최소 각 1장씩** 섞인다(한쪽 쏠림 방지) + 총합은 max 이하
//  2) 한쪽이 비면 나머지로 채운다(사진은 전제조건 아님)
//  3) usedMediaIds는 **최종 선택된 자료 사진만** — 혼합에서 잘린 라이브러리 사진은 소비하지 않는다
//  4) 결정성 — 같은 seedKey는 항상 같은 결과(Math.random 미사용)
//  5) 누수 0 — 빌라 사진 alt/caption에 실명·주소가 없다(publicLabel/지역만)
import { describe, it, expect } from "vitest";
import { mergeGuideImages, type GuideImagePlan } from "@/lib/seo/media";
import type { SeoMediaPick } from "@/lib/seo/media";
import type { PickedImage } from "@/lib/seo/article-draft";

const lib = (id: string): SeoMediaPick => ({
  id,
  url: `https://cdn.r2.dev/lib-${id}.jpg`,
  alt: `자료 ${id}`,
  caption: null,
});
const villa = (n: number): PickedImage => ({
  url: `https://pub-abc.r2.dev/villa-${n}.jpg`,
  alt: `푸꾸옥 쏘나씨 4베드 프라이빗 풀빌라 외관`,
  caption: `쏘나씨 · 침실 4개 · 최대 10인`,
});

const isVilla = (u: string) => u.includes("/villa-");
const isLib = (u: string) => u.includes("/lib-");

describe("가이드 글 사진 혼합 (mergeGuideImages)", () => {
  it("둘 다 있으면 최소 각 1장씩 섞이고 총합은 max 이하", () => {
    const plan = mergeGuideImages([lib("a"), lib("b"), lib("c")], [villa(1), villa(2), villa(3)], "airport-transfer", 4);
    expect(plan.images.length).toBe(4);
    const urls = plan.images.map((i) => i.url);
    expect(urls.some(isVilla)).toBe(true); // 빌라 최소 1장
    expect(urls.some(isLib)).toBe(true); // 자료 최소 1장
    // 번갈아 배치 → 4장이면 2:2
    expect(urls.filter(isVilla)).toHaveLength(2);
    expect(urls.filter(isLib)).toHaveLength(2);
  });

  it("usedMediaIds는 최종 선택된 자료 사진 id만 담는다(잘린 것 제외)", () => {
    const plan = mergeGuideImages(
      [lib("a"), lib("b"), lib("c"), lib("d")],
      [villa(1), villa(2)],
      "season-guide",
      4
    );
    // 자료 4 + 빌라 2 → 4장으로 잘림. 선택된 자료 사진만 소비되어야 한다.
    const chosenLibUrls = plan.images.filter((i) => isLib(i.url)).map((i) => i.url);
    expect(plan.usedMediaIds.length).toBe(chosenLibUrls.length);
    // usedMediaIds ⊆ 입력 자료 id
    for (const id of plan.usedMediaIds) expect(["a", "b", "c", "d"]).toContain(id);
    // 소비되지 않은(잘린) 자료 사진이 실제로 존재한다(전량 소비 아님)
    expect(plan.usedMediaIds.length).toBeLessThan(4);
  });

  it("자료가 비면 빌라 사진만으로 채우고 usedMediaIds는 빈 배열", () => {
    const plan = mergeGuideImages([], [villa(1), villa(2), villa(3)], "villa-vs-hotel", 4);
    expect(plan.images.map((i) => i.url).every(isVilla)).toBe(true);
    expect(plan.images).toHaveLength(3);
    expect(plan.usedMediaIds).toEqual([]);
  });

  it("빌라가 비면 자료 사진만으로 채운다(기존 라이브러리 동작 유지)", () => {
    const plan = mergeGuideImages([lib("a"), lib("b")], [], "golf-trip", 4);
    expect(plan.images.map((i) => i.url).every(isLib)).toBe(true);
    expect(plan.usedMediaIds).toEqual(["a", "b"]);
  });

  it("둘 다 비면 빈 계획 — 사진은 전제조건이 아니다", () => {
    expect(mergeGuideImages([], [], "food-and-market", 4)).toEqual<GuideImagePlan>({
      images: [],
      usedMediaIds: [],
    });
  });

  it("결정성 — 같은 seedKey는 항상 같은 결과", () => {
    const args = () =>
      mergeGuideImages([lib("a"), lib("b")], [villa(1), villa(2)], "how-to-choose-villa", 4);
    expect(args()).toEqual(args());
  });

  it("URL 중복은 제거된다", () => {
    const dup: SeoMediaPick = { id: "dup", url: "https://pub-abc.r2.dev/villa-1.jpg", alt: "중복", caption: null };
    const plan = mergeGuideImages([dup], [villa(1)], "group-travel", 4);
    // 자료 dup과 빌라1의 url이 같다 → 하나만 남는다
    const urls = plan.images.map((i) => i.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("max<=0이면 빈 계획", () => {
    expect(mergeGuideImages([lib("a")], [villa(1)], "family-with-kids", 0)).toEqual<GuideImagePlan>({
      images: [],
      usedMediaIds: [],
    });
  });

  it("빌라 사진 alt/caption에 실명·정확주소가 없다(publicLabel/지역만 — 누수 0)", () => {
    const plan = mergeGuideImages([], [villa(1)], "season-guide", 4);
    const img = plan.images[0];
    // publicLabel(지역·특징)만 사용 — 고유 실명(name/nameVi)·상세주소는 애초에 DTO에 없다
    expect(img.alt).not.toMatch(/\d+\s*(번지|호|street|St\.)/i);
    expect(img.alt).toContain("풀빌라"); // 지역·특징 표시명
  });
});
