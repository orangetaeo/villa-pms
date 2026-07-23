// tests/copy-guide-injection.test.ts — 카피가이드가 모든 생성 경로에 주입되는가 (T-copy-everywhere)
//
// 테오 지시 2026-07-23: "영상을 만들거나 포스팅을 하거나 릴스를 만들 때 카피라이터 MD가 일을 하게 해라. 블로그도 마찬가지."
// ★ 이 테스트가 **회귀 방지선**이다 — 새 생성 경로를 추가하면 여기에도 추가해야 한다.
import { describe, it, expect } from "vitest";
import { ServiceType } from "@prisma/client";
import { copyGuidePromptBlock } from "@/lib/instagram/content-guide";
import { buildPlaceArticlePrompt, PLACE_CATEGORIES, type PlaceRow } from "@/lib/seo/place-article";
import { buildServiceArticlePrompt, serviceTopicByType, buildServiceFacts, type ServiceItemRow } from "@/lib/seo/service-article";
import { buildPlaceCaptionPrompt, buildReelCaptionPrompt, type PlaceIgSource } from "@/lib/instagram/place-draft";
import { buildPlaceShortPrompt } from "@/lib/youtube/place-draft";

const place = {
  id: "p1",
  name: "메오키친",
  nameLocal: null,
  category: "restaurant",
  area: "즈엉동",
  oneLiner: "반세오가 특히 인상 깊었다. 할아버지 맥주는 여기서만 판다",
  tips: null,
  photos: [],
} as unknown as PlaceRow;

const igSrc: PlaceIgSource = {
  articleId: "a1",
  articleSlug: "place-restaurant-1",
  placeName: "메오키친",
  category: "restaurant",
  area: "즈엉동",
  oneLiner: "반세오가 인상 깊었다",
  tips: null,
  photos: [{ id: "1", url: "u", alt: "반세오", kind: "food" }],
};

/** 카피가이드에만 있는 문구 — 프롬프트에 이게 있으면 실제로 주입된 것이다 */
function guideMarker(): string {
  const block = copyGuidePromptBlock();
  expect(block.length).toBeGreaterThan(200); // 파일을 못 읽으면 빈 문자열 → 여기서 잡힌다
  return "카피가이드";
}

describe("카피가이드 주입 — 모든 생성 경로", () => {
  it("① 블로그 장소 글", () => {
    expect(buildPlaceArticlePrompt(PLACE_CATEGORIES[0], [place])).toContain(guideMarker());
  });

  it("② 블로그 서비스 글", () => {
    const items = [
      { id: "c1", type: ServiceType.MASSAGE, nameKo: "아로마 마사지", descKo: "빌라 방문 마사지입니다", unitLabelKo: "1인", options: null, photoUrl: null },
    ] as unknown as ServiceItemRow[];
    const topic = serviceTopicByType(ServiceType.MASSAGE)!;
    expect(buildServiceArticlePrompt(topic, buildServiceFacts(items))).toContain(guideMarker());
  });

  it("③ 인스타 캡션", () => {
    expect(buildPlaceCaptionPrompt(igSrc)).toContain(guideMarker());
  });

  it("④ 릴스·쇼츠 화면 자막", () => {
    expect(buildReelCaptionPrompt(igSrc, copyGuidePromptBlock())).toContain(guideMarker());
  });

  it("⑤ 유튜브 쇼츠 제목·설명", () => {
    expect(buildPlaceShortPrompt(igSrc)).toContain(guideMarker());
  });

  it("카피가이드에 릴스 자막·블로그 문체 규칙이 실제로 들어 있다", () => {
    const guide = copyGuidePromptBlock(20000);
    expect(guide).toContain("릴스·쇼츠 화면 자막");
    expect(guide).toContain("블로그 본문 문체");
    expect(guide).toContain("컷마다 다른 문장");
  });
});
