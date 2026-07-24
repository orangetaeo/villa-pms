// tests/seo-article-jsonld.test.ts — 블로그 글 상세 구조화 데이터(author·BreadcrumbList)
//
// 검증 축:
//   1) author가 브랜드 Organization이고 실명(개인)이 아니다(익명 원칙)
//   2) BreadcrumbList itemListElement의 position이 1..n 연속이고 url이 절대경로다
//   3) 브레드크럼 마지막 계층 = 현재 글 제목(화면 h1과 일치)
import { describe, it, expect } from "vitest";
import { ARTICLE_AUTHOR_LD, ARTICLE_BYLINE, buildBreadcrumbLd } from "@/lib/seo/article-jsonld";
import { seoArticleCategoryLabel } from "@/lib/seo/categories";

describe("Article author (E-E-A-T)", () => {
  it("브랜드 Organization 저자 — 실명 노출 없음", () => {
    expect(ARTICLE_AUTHOR_LD["@type"]).toBe("Organization");
    expect(ARTICLE_AUTHOR_LD.name).toBe("Villa GO");
    expect(ARTICLE_AUTHOR_LD.url).toMatch(/^https?:\/\//);
  });

  it("바이라인 문구가 저자 주체와 같은 브랜드를 가리킨다", () => {
    expect(ARTICLE_BYLINE).toContain("Villa GO");
  });

  it("JSON-LD 직렬화 문자열에 author가 실린다", () => {
    const json = JSON.stringify({ author: ARTICLE_AUTHOR_LD });
    expect(json).toContain('"author"');
    expect(json).toContain('"Villa GO"');
  });
});

describe("BreadcrumbList", () => {
  const article = { slug: "pho-quoc-cafe-1", title: "푸꾸옥 카페 3곳 — 직접 가본 곳만", category: "place" as const };

  it("@type이 BreadcrumbList이고 3계층(홈 → 카테고리 → 글)", () => {
    const ld = buildBreadcrumbLd(article);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toHaveLength(3);
  });

  it("position이 1..n 연속", () => {
    const ld = buildBreadcrumbLd(article);
    expect(ld.itemListElement.map((e) => e.position)).toEqual([1, 2, 3]);
  });

  it("모든 item url이 절대경로(https)", () => {
    const ld = buildBreadcrumbLd(article);
    for (const e of ld.itemListElement) {
      expect(e.item).toMatch(/^https?:\/\//);
    }
  });

  it("2번째 계층 = 카테고리 라벨, 마지막 = 현재 글 제목", () => {
    const ld = buildBreadcrumbLd(article);
    expect(ld.itemListElement[1].name).toBe(seoArticleCategoryLabel("place"));
    expect(ld.itemListElement[2].name).toBe(article.title);
  });

  it("직렬화 문자열에 @type:BreadcrumbList가 실린다", () => {
    const json = JSON.stringify(buildBreadcrumbLd(article));
    expect(json).toContain('"BreadcrumbList"');
  });
});
