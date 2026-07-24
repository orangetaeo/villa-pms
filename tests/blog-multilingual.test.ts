// tests/blog-multilingual.test.ts — 공개 블로그 다국어화 회귀 (ADR-0049)
//
// 잠그는 것: ① locale URL 규약(ko 프리픽스 없음·비-ko `/{l}/blog`) ② 소스 해시 안정성
//   ③ 누수 가드(실명·금액) ④ 번역 항목 추출이 img.url·ytVideoId를 절대 내보내지 않음.
import { describe, it, expect } from "vitest";
import { articleSourceHash, OG_LOCALE, BCP47 } from "@/lib/seo/article-i18n";
import { parseBlogLocaleParam, blogLocalePrefix, NON_KO_BLOG_LOCALES } from "@/lib/seo/blog-locale";
import { blogPaths, isPublicSeoPath } from "@/lib/seo/routes";
import {
  scanMoneyLeak,
  scanRealNameLeak,
  extractTranslatableItems,
} from "@/lib/seo/translate-article";
import type { ArticleBlock } from "@/lib/seo/article";
import { PUBLIC_LOCALES } from "@/lib/seo/public-i18n";

describe("blog locale URL 규약", () => {
  it("ko는 프리픽스 없음, 비-ko는 /{l} 프리픽스", () => {
    expect(blogLocalePrefix("ko")).toBe("");
    expect(blogLocalePrefix("en")).toBe("/en");
    expect(blogPaths.article("my-slug")).toBe("/blog/my-slug");
    expect(blogPaths.article("my-slug", "ko")).toBe("/blog/my-slug");
    expect(blogPaths.article("my-slug", "en")).toBe("/en/blog/my-slug");
    expect(blogPaths.hub("vi")).toBe("/vi/blog");
    expect(blogPaths.categoryList("guide", "ru")).toBe("/ru/blog/category/guide");
    expect(blogPaths.hub()).toBe("/blog"); // 기본값 = ko
  });

  it("parseBlogLocaleParam은 비-ko만 통과", () => {
    expect(parseBlogLocaleParam("en")).toBe("en");
    expect(parseBlogLocaleParam("zh")).toBe("zh");
    expect(parseBlogLocaleParam("ko")).toBeNull(); // ko는 캐논(프리픽스 없음)
    expect(parseBlogLocaleParam("fr")).toBeNull();
    expect(parseBlogLocaleParam(undefined)).toBeNull();
  });

  it("isPublicSeoPath는 비-ko 블로그 프리픽스를 인식한다", () => {
    expect(isPublicSeoPath("/")).toBe(true);
    expect(isPublicSeoPath("/blog")).toBe(true);
    expect(isPublicSeoPath("/blog/x")).toBe(true);
    expect(isPublicSeoPath("/en/blog")).toBe(true);
    expect(isPublicSeoPath("/en/blog/some-slug")).toBe(true);
    expect(isPublicSeoPath("/zh/blog/category/guide")).toBe(true);
    // 무관 경로는 프리픽스 오인 제거 안 함
    expect(isPublicSeoPath("/en")).toBe(false);
    expect(isPublicSeoPath("/vietnam")).toBe(false);
    expect(isPublicSeoPath("/login")).toBe(false);
  });
});

describe("articleSourceHash", () => {
  const base = { title: "제목", summary: "요약", bodyJson: [{ type: "p", text: "본문" }] };
  it("같은 입력은 같은 해시(결정형)", () => {
    expect(articleSourceHash(base)).toBe(articleSourceHash({ ...base }));
  });
  it("제목·요약·본문 중 하나만 바뀌어도 해시가 달라진다", () => {
    expect(articleSourceHash(base)).not.toBe(articleSourceHash({ ...base, title: "다른 제목" }));
    expect(articleSourceHash(base)).not.toBe(articleSourceHash({ ...base, summary: "다른 요약" }));
    expect(articleSourceHash(base)).not.toBe(
      articleSourceHash({ ...base, bodyJson: [{ type: "p", text: "다른 본문" }] }),
    );
  });
});

describe("누수 가드", () => {
  it("금액 패턴을 잡는다", () => {
    expect(scanMoneyLeak("입장료 ₩50000")).not.toBeNull();
    expect(scanMoneyLeak("가격 5만원")).not.toBeNull();
    expect(scanMoneyLeak("VND 100000")).not.toBeNull();
    expect(scanMoneyLeak("$120 per night")).not.toBeNull();
    expect(scanMoneyLeak("100000동")).not.toBeNull();
    // 금액 없는 정상 문장은 통과
    expect(scanMoneyLeak("A beautiful pool villa near the beach")).toBeNull();
    expect(scanMoneyLeak("3 bedrooms and 2 bathrooms")).toBeNull();
  });

  it("빌라 고유 실명이 통째로 등장하면 잡는다(3자 미만 needle은 제외)", () => {
    const needles = ["sonasea v12", "m villa m1"];
    expect(scanRealNameLeak("Stay at Sonasea V12 tonight", needles)).toBe("sonasea v12");
    expect(scanRealNameLeak("A quiet pool villa", needles)).toBeNull();
    expect(scanRealNameLeak("ab appears here", ["ab"])).toBeNull(); // 2자 needle 무시
  });
});

describe("extractTranslatableItems — 구조 안전(url/id 미노출)", () => {
  const blocks: ArticleBlock[] = [
    { type: "h2", text: "소제목" },
    { type: "p", text: "문단" },
    { type: "ul", items: ["항목1", "항목2"] },
    { type: "img", url: "https://x.r2.dev/a.jpg", alt: "대체텍스트", caption: "설명" },
    { type: "video", ytVideoId: "abc123XYZ", title: "영상 제목" },
  ];
  const ex = extractTranslatableItems({ title: "제목", summary: "요약", blocks });

  it("번역 항목에 img.url·ytVideoId가 절대 포함되지 않는다", () => {
    const texts = ex.items.map((i) => i.text);
    expect(texts).not.toContain("https://x.r2.dev/a.jpg");
    expect(texts).not.toContain("abc123XYZ");
  });

  it("추출 항목 = title+summary+블록 텍스트(이미지 alt·caption·비디오 title 포함)", () => {
    // title, summary, h2, p, li×2, imgAlt, imgCaption, videoTitle = 9
    expect(ex.items.length).toBe(9);
    const kinds = ex.items.map((i) => i.kind);
    expect(kinds).toContain("imgAlt");
    expect(kinds).toContain("imgCaption");
    expect(kinds).toContain("videoTitle");
  });
});

describe("언어 코드 매핑 완전성", () => {
  it("OG_LOCALE·BCP47은 5개 공개 로케일 전부를 덮는다", () => {
    for (const l of PUBLIC_LOCALES) {
      expect(OG_LOCALE[l.code]).toBeTruthy();
      expect(BCP47[l.code]).toBeTruthy();
    }
    expect(NON_KO_BLOG_LOCALES).toEqual(["en", "vi", "ru", "zh"]);
  });
});
