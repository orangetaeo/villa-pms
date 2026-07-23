// tests/marketing-source-label.test.ts — 콘텐츠 소재 표기 (T-ig-source-ui)
//
// 테오 지적 2026-07-23: 장소 소재 포스트가 화면에 **"빌라 미지정"** 으로만 보였다.
// 빌라가 아닌 소재(맛집·카페)를 담을 자리가 UI에 없어서 생긴 문제.
import { describe, it, expect } from "vitest";
import { serializeIgPost } from "@/lib/instagram/serialize";
import { serializeYtShort } from "@/lib/youtube/serialize";

const base = {
  id: "p1",
  villaId: null,
  kind: "INFO",
  status: "PENDING_APPROVAL",
  scheduledAt: new Date("2026-07-24T00:00:00Z"),
  caption: "캡션",
  mediaJson: [],
  igMediaId: null,
  igPermalink: null,
  publishedAt: null,
  failReason: null,
  flaggedTerms: null,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  latestReach: null,
  latestInsightsJson: null,
  insightsSyncedAt: null,
} as unknown as Parameters<typeof serializeIgPost>[0];

describe("인스타 소재 표기", () => {
  it("★ 장소 소재면 가게 이름이 나온다 — '빌라 미지정'이 아니라", () => {
    const out = serializeIgPost({
      ...base,
      seoArticleId: "a1",
      seoArticle: { slug: "place-restaurant-6", title: "푸꾸옥 메오키친 — 푸꾸옥 즈엉동 맛집, 직접 가보고 적는다" },
    } as unknown as Parameters<typeof serializeIgPost>[0]);
    expect(out.sourceKind).toBe("place");
    expect(out.sourceName).toBe("푸꾸옥 메오키친");
    expect(out.articleSlug).toBe("place-restaurant-6");
  });

  it("빌라 소재는 기존 그대로", () => {
    const out = serializeIgPost({
      ...base,
      villaId: "v1",
      villa: { name: "M villa M1" },
      seoArticleId: null,
    } as unknown as Parameters<typeof serializeIgPost>[0]);
    expect(out.sourceKind).toBe("villa");
    expect(out.sourceName).toBeNull();
    expect(out.villaName).toBe("M villa M1");
  });
});

describe("유튜브 소재 표기", () => {
  it("장소 쇼츠도 가게 이름이 나온다", () => {
    const out = serializeYtShort({
      id: "s1",
      villaId: null,
      instagramPostId: null,
      sourceType: "PLACE_AUTO",
      status: "PENDING_APPROVAL",
      scheduledAt: new Date(),
      title: "제목",
      description: "설명",
      tags: [],
      videoUrl: "u",
      posterUrl: null,
      durationSec: 16,
      ytVideoId: null,
      ytPrivacyStatus: null,
      publishedAt: null,
      failReason: null,
      flaggedTerms: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      seoArticle: { slug: "place-restaurant-6", title: "푸꾸옥 메오키친 — 푸꾸옥 즈엉동 맛집" },
    } as unknown as Parameters<typeof serializeYtShort>[0]);
    expect(out.sourceName).toBe("푸꾸옥 메오키친");
  });
});
