// tests/seo-gallery.test.ts — 본문 이미지 그리드 갤러리 (T-blog-gallery)
//
// 지키는 것:
//  1) 연속 img 블록만 갤러리로 묶고, 텍스트 사이 단일 이미지는 그대로 둔다(순서 보존)
//  2) 행 분할이 좌우 대칭이고 마지막이 1장으로 외롭게 남지 않는다
//  3) 그룹 배치가 사진-장소 짝(묶음)·골고루 흩뿌리기(단독)를 만든다
import { describe, it, expect } from "vitest";
import { galleryRows, groupBlocksForRender } from "@/lib/seo/gallery";
import { interleaveImageGroups, spreadImageGroups } from "@/lib/seo/article-draft";
import type { ArticleBlock } from "@/lib/seo/article";

const img = (n: string): ArticleBlock => ({ type: "img", url: `https://cdn.r2.dev/${n}.jpg`, alt: n });
const pick = (n: string) => ({ url: `https://cdn.r2.dev/${n}.jpg`, alt: n });

describe("galleryRows — 좌우 대칭·외톨이 방지", () => {
  it("한 행 최대 3장, 나머지 1장은 2+2로 마무리한다", () => {
    expect(galleryRows(0)).toEqual([]);
    expect(galleryRows(1)).toEqual([1]);
    expect(galleryRows(2)).toEqual([2]);
    expect(galleryRows(3)).toEqual([3]);
    expect(galleryRows(4)).toEqual([2, 2]);
    expect(galleryRows(5)).toEqual([3, 2]);
    expect(galleryRows(6)).toEqual([3, 3]);
    expect(galleryRows(7)).toEqual([3, 2, 2]);
    expect(galleryRows(8)).toEqual([3, 3, 2]);
    expect(galleryRows(10)).toEqual([3, 3, 2, 2]);
  });

  it("어떤 장수든 합계가 보존되고 각 행은 3장 이하", () => {
    for (let n = 1; n <= 30; n++) {
      const rows = galleryRows(n);
      expect(rows.reduce((a, b) => a + b, 0)).toBe(n);
      expect(rows.every((r) => r >= 1 && r <= 3)).toBe(true);
      if (n >= 2) expect(rows[rows.length - 1]).toBeGreaterThanOrEqual(2); // 마지막 외톨이 방지
    }
  });
});

describe("groupBlocksForRender — 연속 이미지만 묶는다", () => {
  it("2장 이상 연속은 갤러리, 1장은 단일 블록, 순서 보존", () => {
    const blocks: ArticleBlock[] = [
      { type: "p", text: "리드" },
      img("a"),
      { type: "h2", text: "소제목" },
      img("b"),
      img("c"),
      img("d"),
      { type: "p", text: "끝" },
    ];
    const out = groupBlocksForRender(blocks);
    expect(out.map((x) => x.kind)).toEqual(["block", "block", "block", "gallery", "block"]);
    const gal = out[3];
    expect(gal.kind === "gallery" && gal.images.map((im) => im.alt)).toEqual(["b", "c", "d"]);
    // 단독 이미지(a)는 갤러리로 묶이지 않는다
    expect(out[1].kind === "block" && out[1].block.type).toBe("img");
  });

  it("이미지가 없으면 갤러리가 생기지 않는다", () => {
    const blocks: ArticleBlock[] = [{ type: "p", text: "글만" }];
    expect(groupBlocksForRender(blocks).every((x) => x.kind === "block")).toBe(true);
  });
});

describe("interleaveImageGroups — 그룹을 소제목마다 연속 배치", () => {
  it("그룹의 이미지들이 그 소제목 아래 연속으로 들어가 갤러리가 된다", () => {
    const blocks: ArticleBlock[] = [
      { type: "p", text: "리드" },
      { type: "h2", text: "가게1" },
      { type: "p", text: "문단1" },
      { type: "h2", text: "가게2" },
      { type: "p", text: "문단2" },
    ];
    const out = interleaveImageGroups(blocks, [[pick("a"), pick("b")], [pick("c")]]);
    // 각 소제목 첫 문단 뒤에 그 그룹 이미지가 붙는다
    const groups = groupBlocksForRender(out);
    const gal = groups.find((g) => g.kind === "gallery");
    expect(gal && gal.kind === "gallery" && gal.images.map((im) => im.alt)).toEqual(["a", "b"]);
    // 총 이미지 3장이 본문에 모두 들어갔다(한 장도 버리지 않는다)
    expect(out.filter((b) => b.type === "img")).toHaveLength(3);
  });

  it("소제목보다 그룹이 많으면 나머지는 본문 끝에 붙는다", () => {
    const blocks: ArticleBlock[] = [{ type: "h2", text: "하나" }, { type: "p", text: "문단" }];
    const out = interleaveImageGroups(blocks, [[pick("a")], [pick("b")], [pick("c")]]);
    expect(out.filter((b) => b.type === "img")).toHaveLength(3);
  });
});

describe("spreadImageGroups — 단독 스트림을 소제목 수만큼 흩뿌린다", () => {
  it("소제목이 여러 개면 이미지를 나눠 여러 갤러리로 배치한다", () => {
    const blocks: ArticleBlock[] = [
      { type: "p", text: "리드" },
      { type: "h2", text: "가" },
      { type: "p", text: "1" },
      { type: "h2", text: "나" },
      { type: "p", text: "2" },
      { type: "h2", text: "다" },
      { type: "p", text: "3" },
    ];
    const imgs = Array.from({ length: 9 }, (_, k) => pick(`x${k}`));
    const out = spreadImageGroups(blocks, imgs);
    // 한 장도 버리지 않는다
    expect(out.filter((b) => b.type === "img")).toHaveLength(9);
    // 3개 소제목에 나뉘어 들어가 갤러리가 2개 이상 생긴다(한 덩어리로 쏠리지 않음)
    const galleries = groupBlocksForRender(out).filter((g) => g.kind === "gallery");
    expect(galleries.length).toBeGreaterThanOrEqual(2);
  });

  it("이미지가 없으면 블록을 그대로 돌려준다", () => {
    const blocks: ArticleBlock[] = [{ type: "p", text: "글" }];
    expect(spreadImageGroups(blocks, [])).toBe(blocks);
  });
});
