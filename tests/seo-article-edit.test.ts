// tests/seo-article-edit.test.ts — 승인 화면 본문 편집 (T-seo-article-edit)
//
// 여기서 지키는 것:
//  1) ★ 폼 배열 인덱스가 밀리지 않는다 — 블록마다 모든 필드가 하나씩 나가는 계약
//  2) 삭제(select=drop)한 블록은 빠지고 순서는 유지된다
//  3) 비운 문단은 삭제와 같다 / alt 없는 이미지는 저장되지 않는다(파서 계약과 동일)
import { describe, it, expect } from "vitest";
import { parseEditedBlocks, parseEditedArticle } from "@/lib/seo/article-edit";

/** 실제 폼과 같은 모양 — 블록마다 모든 필드가 하나씩 */
function form(blocks: { type: string; keep?: string; text?: string; url?: string; alt?: string; video?: string }[]) {
  const fd = new FormData();
  fd.set("title", "제목");
  fd.set("summary", "요약");
  for (const b of blocks) {
    fd.append("bType", b.type);
    fd.append("bKeep", b.keep ?? "keep");
    fd.append("bText", b.text ?? "");
    fd.append("bUrl", b.url ?? "");
    fd.append("bAlt", b.alt ?? "");
    fd.append("bVideo", b.video ?? "");
  }
  return fd;
}

describe("본문 편집 파싱", () => {
  it("고친 문장이 그대로 반영되고 순서가 유지된다", () => {
    const out = parseEditedBlocks(
      form([
        { type: "h2", text: "소제목" },
        { type: "p", text: "고친 문장" },
        { type: "img", url: "https://cdn.r2.dev/a.jpg", alt: "설명", text: "캡션" },
      ])
    );
    expect(out).toEqual([
      { type: "h2", text: "소제목" },
      { type: "p", text: "고친 문장" },
      { type: "img", url: "https://cdn.r2.dev/a.jpg", alt: "설명", caption: "캡션" },
    ]);
  });

  it("★ 삭제한 블록만 빠지고 나머지 값이 섞이지 않는다(인덱스 밀림 방지)", () => {
    const out = parseEditedBlocks(
      form([
        { type: "p", text: "첫 문단" },
        { type: "img", url: "https://cdn.r2.dev/a.jpg", alt: "지울 사진", keep: "drop" },
        { type: "p", text: "둘째 문단" },
        { type: "img", url: "https://cdn.r2.dev/b.jpg", alt: "남길 사진" },
      ])
    );
    expect(out).toEqual([
      { type: "p", text: "첫 문단" },
      { type: "p", text: "둘째 문단" },
      { type: "img", url: "https://cdn.r2.dev/b.jpg", alt: "남길 사진" },
    ]);
  });

  it("문단을 비우면 삭제와 같다", () => {
    expect(parseEditedBlocks(form([{ type: "p", text: "   " }, { type: "p", text: "남는다" }]))).toEqual([
      { type: "p", text: "남는다" },
    ]);
  });

  it("alt를 지운 사진은 저장되지 않는다(파서가 어차피 버린다)", () => {
    expect(parseEditedBlocks(form([{ type: "img", url: "https://cdn.r2.dev/a.jpg", alt: "" }]))).toEqual([]);
  });

  it("목록은 줄바꿈으로 항목을 나눈다", () => {
    const text = ["가", "", "나"].join(String.fromCharCode(10));
    expect(parseEditedBlocks(form([{ type: "ul", text }]))).toEqual([{ type: "ul", items: ["가", "나"] }]);
  });

  it("제목·요약도 함께 읽는다", () => {
    const parsed = parseEditedArticle(form([{ type: "p", text: "본문" }]));
    expect(parsed.title).toBe("제목");
    expect(parsed.summary).toBe("요약");
    expect(parsed.blocks).toHaveLength(1);
  });
});
