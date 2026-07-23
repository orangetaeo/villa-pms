// tests/instagram-place-draft.test.ts — 장소 글을 인스타 소재로 재사용 (T-seo-to-instagram)
//
// 여기서 지키는 것:
//  1) 발행된 장소 글 + 사진 4장 이상 + **아직 포스트 없는 글**만 소재가 된다(도배 방지)
//  2) 슬라이드는 커버 → 사진들 → CTA. 빌라 전용 info 슬라이드를 쓰지 않는다
//  3) 캡션 프롬프트에 **가격·영업시간·전화 금지**가 명시되고, 등록 사실만 들어간다
import { describe, it, expect } from "vitest";
import {
  selectPlaceArticlesForIg,
  buildPlaceSlides,
  buildPlaceHeadline,
  buildPlaceCaptionPrompt,
  fallbackPlaceCaption,
  MIN_PLACE_PHOTOS_FOR_IG,
  type PlaceIgSource,
} from "@/lib/instagram/place-draft";
import {
  buildPlaceShortTitle,
  buildPlaceShortPrompt,
  fallbackPlaceShortDescription,
} from "@/lib/youtube/place-draft";
import type { DbClient } from "@/lib/availability";

const photo = (id: string, kind: string | null = "food") => ({
  id,
  url: `https://cdn.r2.dev/${id}.jpg`,
  alt: id,
  kind,
});

const src = (over: Partial<PlaceIgSource> = {}): PlaceIgSource => ({
  articleId: "a1",
  articleSlug: "place-restaurant-1",
  placeName: "메오키친",
  category: "restaurant",
  area: "즈엉동",
  oneLiner: "베트남에서 먹어본 반세오 중에 최고. 할아버지 맥주는 푸꾸옥에서만 판다",
  tips: null,
  photos: [photo("입구", "exterior"), photo("반세오"), photo("반미"), photo("꼬치")],
  ...over,
});

function makeDb(articles: { id: string; slug: string }[], places: unknown[]) {
  const calls: { articleWhere?: Record<string, unknown> } = {};
  return {
    db: {
      seoArticle: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          calls.articleWhere = args.where;
          return articles;
        },
      },
      seoPlace: { findMany: async () => places },
    } as unknown as DbClient,
    calls,
  };
}

describe("소재 선택", () => {
  it("발행 + 포스트 없음 조건으로만 조회한다", async () => {
    const { db, calls } = makeDb([], []);
    await selectPlaceArticlesForIg(3, db);
    expect(calls.articleWhere).toMatchObject({
      status: "PUBLISHED",
      topicKey: { startsWith: "place-" },
      igPosts: { none: {} },
    });
  });

  it("사진이 4장 미만인 장소는 소재가 되지 않는다", async () => {
    const { db } = makeDb(
      [{ id: "a1", slug: "place-restaurant-1" }],
      [
        {
          id: "p1",
          name: "메오키친",
          category: "restaurant",
          area: "즈엉동",
          oneLiner: "좋다",
          tips: null,
          usedInArticleId: "a1",
          photos: [photo("1"), photo("2"), photo("3")],
        },
      ]
    );
    expect(await selectPlaceArticlesForIg(3, db)).toEqual([]);
    expect(MIN_PLACE_PHOTOS_FOR_IG).toBe(4);
  });

  it("묶음 글이면 사진이 가장 많은 가게를 대표로 쓴다", async () => {
    const { db } = makeDb(
      [{ id: "a1", slug: "place-cafe-1" }],
      [
        {
          id: "p1",
          name: "카페A",
          category: "cafe",
          area: null,
          oneLiner: "조용하다",
          tips: null,
          usedInArticleId: "a1",
          photos: [photo("1"), photo("2"), photo("3"), photo("4")],
        },
        {
          id: "p2",
          name: "카페B",
          category: "cafe",
          area: null,
          oneLiner: "넓다",
          tips: null,
          usedInArticleId: "a1",
          photos: [photo("1"), photo("2"), photo("3"), photo("4"), photo("5")],
        },
      ]
    );
    const out = await selectPlaceArticlesForIg(3, db);
    expect(out).toHaveLength(1);
    expect(out[0].placeName).toBe("카페B");
  });

  it("limit 0이면 조회하지 않는다 — 빌라가 슬롯을 다 쓴 경우", async () => {
    const { db, calls } = makeDb([{ id: "a1", slug: "s" }], []);
    expect(await selectPlaceArticlesForIg(0, db)).toEqual([]);
    expect(calls.articleWhere).toBeUndefined();
  });
});

describe("슬라이드·헤드라인", () => {
  it("커버 → 사진 → CTA 순이고 빌라 전용 info 슬라이드가 없다", () => {
    const slides = buildPlaceSlides(src());
    expect(slides[0].templateId).toBe("cover");
    expect(slides[slides.length - 1].templateId).toBe("cta");
    expect(slides.some((s) => s.templateId === "info")).toBe(false);
    expect(slides.filter((s) => s.templateId === "raw")).toHaveLength(3);
  });

  it("헤드라인은 가게 이름이 먼저 온다", () => {
    expect(buildPlaceHeadline(src())).toBe("메오키친\n푸꾸옥 즈엉동 맛집");
  });

  it("사진 캡션은 사람이 쓴 설명 그대로다(짓지 않는다)", () => {
    const slides = buildPlaceSlides(src());
    const raw = slides.find((s) => s.templateId === "raw");
    expect(raw && "reelCaption" in raw ? raw.reelCaption : null).toBe("반세오");
  });
});

describe("캡션", () => {
  it("★ 변하는 정보 금지가 프롬프트에 명시된다", () => {
    const p = buildPlaceCaptionPrompt(src());
    expect(p).toContain("가격·영업시간·휴무일·전화번호·정확한 주소를 쓰지 마라");
    expect(p).toContain("지어내지 마라");
    expect(p).toContain("메오키친");
    expect(p).toContain("반세오"); // 사진 설명이 사실 재료로 들어간다
  });

  it("Gemini 실패 시 폴백은 사람이 쓴 인상만으로 구성된다", () => {
    const text = fallbackPlaceCaption(src());
    expect(text).toContain("메오키친");
    expect(text).toContain("반세오");
    expect(text).not.toMatch(/\d{1,3},\d{3}|원|동\b|시\s?~|전화/);
  });
});

describe("유튜브 쇼츠 소재 (S2)", () => {
  it("쇼츠 배치는 인스타 포스트 유무를 무시하고 쇼츠 없는 글만 고른다", async () => {
    const { db, calls } = makeDb([], []);
    await selectPlaceArticlesForIg(2, db, { excludeShorts: true, ignoreIgPosts: true });
    expect(calls.articleWhere).toMatchObject({ status: "PUBLISHED", ytShorts: { none: {} } });
    expect(calls.articleWhere).not.toHaveProperty("igPosts");
  });

  it("쇼츠 제목은 가게 이름 + 지역 + #shorts", () => {
    expect(buildPlaceShortTitle(src())).toBe("메오키친 | 푸꾸옥 즈엉동 맛집 #shorts");
  });

  it("★ 쇼츠 설명 프롬프트도 가격·영업시간을 금지한다(영상은 올린 뒤 못 고친다)", () => {
    const p = buildPlaceShortPrompt(src());
    expect(p).toContain("가격·영업시간·휴무일·전화번호·정확한 주소 금지");
    expect(p).toContain("지어내지 마라");
  });

  it("설명 폴백은 사람이 쓴 인상만으로 구성된다", () => {
    expect(fallbackPlaceShortDescription(src())).toContain("반세오");
  });
});
