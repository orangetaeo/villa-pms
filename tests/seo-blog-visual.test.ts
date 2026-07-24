// tests/seo-blog-visual.test.ts — 중복 제거·썸네일 문구·상세페이지 HTML (T-blog-visual)
//
// 테오 실측 지적에서 나온 3건:
//  1) 같은 문단·같은 사진이 두 번 나왔다
//  2) 블로그 이미지에 워터마크가 없었다(워터마크 SVG는 여기서 형태만 검증)
//  3) 썸네일에 텍스트가 필요하고, 상세페이지는 HTML로 뽑을 수 있어야 한다
import { describe, it, expect } from "vitest";
import { dedupeParagraphs, buildThumbnailHook } from "@/lib/seo/place-article";
import { toArticleHtml, escapeHtml } from "@/lib/seo/article-html";
import { buildWatermarkSvg } from "@/lib/seo/watermark-server";
import type { ArticleBlock } from "@/lib/seo/article";

describe("중복 제거", () => {
  it("★ 같은 문단이 두 번 나오면 하나만 남긴다(모델이 리드 문단을 반복한 실사례)", () => {
    const blocks = [
      { type: "p" as const, text: "푸꾸옥에서 빌라를 운영하며 직접 다녀온 곳을 소개합니다." },
      { type: "p" as const, text: "푸꾸옥에서 빌라를 운영하며 직접 다녀온 곳을 소개합니다." },
      { type: "h2" as const, text: "제목" },
      { type: "p" as const, text: "다른 문단" },
    ];
    expect(dedupeParagraphs(blocks)).toEqual([blocks[0], blocks[2], blocks[3]]);
  });

  it("공백만 다른 반복도 같은 문단으로 본다", () => {
    const blocks = [
      { type: "p" as const, text: "같은  문장" },
      { type: "p" as const, text: "같은 문장" },
    ];
    expect(dedupeParagraphs(blocks)).toHaveLength(1);
  });
});

describe("썸네일 문구", () => {
  it("운영자가 쓴 인상의 첫 문장을 그대로 쓴다(새 문구를 만들지 않는다)", () => {
    expect(buildThumbnailHook("베트남에서 먹어본 반세오 중 최고\n할아버지 맥주도 있다")).toBe(
      "베트남에서 먹어본 반세오 중 최고"
    );
  });

  it("길면 어절 경계에서 자른다", () => {
    const hook = buildThumbnailHook("아주 길게 늘어지는 문장이 계속 이어지는 경우를 자른다", 20);
    expect(hook && hook.length).toBeLessThanOrEqual(21);
    expect(hook?.endsWith("…")).toBe(true);
  });

  it("빈 인상이면 null", () => {
    expect(buildThumbnailHook("   ")).toBeNull();
  });
});

describe("상세페이지 HTML", () => {
  const blocks = [
    { type: "h2" as const, text: "소제목" },
    { type: "p" as const, text: "본문 문단" },
    { type: "img" as const, url: "https://cdn.r2.dev/a.jpg", alt: "사진 설명", caption: "캡션" },
    { type: "ul" as const, items: ["가", "나"] },
  ];

  it("홈페이지에 붙일 수 있는 형태로 변환된다", () => {
    const html = toArticleHtml(blocks, { title: "제목", thumbnailUrl: "https://cdn.r2.dev/t.jpg", summary: "요약" });
    expect(html).toContain('<article class="vg-article">');
    expect(html).toContain('<h1 class="vg-title">제목</h1>');
    expect(html).toContain('class="vg-hero"');
    expect(html).toContain("<h2 class=\"vg-h2\">소제목</h2>");
    expect(html).toContain('<img src="https://cdn.r2.dev/a.jpg" alt="사진 설명"');
    expect(html).toContain("<figcaption>캡션</figcaption>");
    expect(html).toContain("<li>가</li><li>나</li>");
  });

  it("★ 연속 이미지는 그리드 갤러리로, 단독 이미지는 기존 figure로 렌더한다", () => {
    const many: ArticleBlock[] = [
      { type: "h2", text: "음식" },
      { type: "p", text: "본문" },
      { type: "img", url: "https://cdn.r2.dev/1.jpg", alt: "1" },
      { type: "img", url: "https://cdn.r2.dev/2.jpg", alt: "2" },
      { type: "img", url: "https://cdn.r2.dev/3.jpg", alt: "3" },
      { type: "img", url: "https://cdn.r2.dev/4.jpg", alt: "4" },
    ];
    const html = toArticleHtml(many, { title: "t" });
    expect(html).toContain('<div class="vg-gallery">');
    // 4장 → 2+2 대칭
    expect((html.match(/vg-cols-2/g) ?? []).length).toBe(2);
    expect(html).not.toContain("vg-cols-1");
    // 단독 이미지 한 장은 갤러리로 묶이지 않는다
    const single = toArticleHtml(
      [{ type: "img" as const, url: "https://cdn.r2.dev/a.jpg", alt: "a" }],
      { title: "t" }
    );
    expect(single).toContain('class="vg-figure"');
    expect(single).not.toContain("vg-gallery");
  });

  it("★ 본문은 Gemini 산출물이라 태그를 이스케이프한다", () => {
    const html = toArticleHtml([{ type: "p", text: '<script>alert("x")</script>' }], { title: "t" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(escapeHtml(`a<b>&'"`)).toBe("a&lt;b&gt;&amp;&#39;&quot;");
  });
});

describe("워터마크", () => {
  it("대각선 반복 타일 SVG를 만든다 — 한쪽 모서리만 잘라도 제거되지 않게", () => {
    const svg = buildWatermarkSvg(1200, 800);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("rotate(-30");
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThan(20); // 타일이 여러 개
    expect(svg).toContain("Villa Go");
  });
});
