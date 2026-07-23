// tests/seo-media.test.ts — 가이드 글 자료 사진 라이브러리 (T-seo-media-library)
//
// 여기서 지키는 것:
//  1) 주제 일치 사진 우선, 모자라면 범용으로 채운다 — 주제와 무관한 사진이 본문에 들어가지 않게
//  2) 덜 쓴 사진 우선(usedCount asc) — 같은 사진이 모든 글에 반복되면 그 자체가 저품질 신호
//  3) 라이브러리가 비어도 글 생성은 그대로 — 사진은 선택 재료지 전제조건이 아니다
//  4) alt 없는 사진·허용 밖 호스트는 저장 단계에서 막는다(파서가 버려서 조용히 사라지기 전에)
import { describe, it, expect } from "vitest";
import {
  pickMediaForTopic,
  toPickedImages,
  normalizeTopicKeys,
  validateMediaInput,
  MAX_MEDIA_PER_ARTICLE,
} from "@/lib/seo/media";
import { interleaveImages } from "@/lib/seo/article-draft";
import { bodyTextLength, isArticlePublishable } from "@/lib/seo/article";
import type { DbClient } from "@/lib/availability";

interface Row {
  id: string;
  url: string;
  alt: string;
  caption: string | null;
  topicKeys: string[];
  usedCount: number;
}

/** where(topicKeys has/isEmpty, id notIn) + orderBy(usedCount asc) + take를 흉내 내는 최소 stub */
function makeDb(rows: Row[]) {
  const calls: { wheres: unknown[] } = { wheres: [] };
  const db = {
    seoMedia: {
      findMany: async (args: {
        where: { topicKeys?: { has?: string; isEmpty?: boolean }; id?: { notIn: string[] } };
        take: number;
      }) => {
        calls.wheres.push(args.where);
        const { topicKeys, id } = args.where;
        let out = rows.slice();
        if (topicKeys?.has) out = out.filter((r) => r.topicKeys.includes(topicKeys.has!));
        if (topicKeys?.isEmpty) out = out.filter((r) => r.topicKeys.length === 0);
        if (id?.notIn) out = out.filter((r) => !id.notIn.includes(r.id));
        out.sort((a, b) => a.usedCount - b.usedCount);
        return out.slice(0, args.take).map((r) => ({ id: r.id, url: r.url, alt: r.alt, caption: r.caption }));
      },
    },
  } as unknown as DbClient;
  return { db, calls };
}

const row = (over: Partial<Row> & { id: string }): Row => ({
  url: `https://cdn.r2.dev/${over.id}.jpg`,
  alt: `사진 ${over.id}`,
  caption: null,
  topicKeys: [],
  usedCount: 0,
  ...over,
});

describe("주제별 사진 선택", () => {
  it("주제가 일치하는 사진을 먼저, 모자라면 범용으로 채운다", async () => {
    const { db } = makeDb([
      row({ id: "m1", topicKeys: ["airport-transfer"] }),
      row({ id: "g1" }), // 범용
      row({ id: "x1", topicKeys: ["golf-trip"] }), // 다른 주제 — 절대 안 나와야 한다
    ]);
    const picked = await pickMediaForTopic("airport-transfer", 3, db);
    expect(picked.map((p) => p.id)).toEqual(["m1", "g1"]);
  });

  it("다른 주제 전용 사진은 채우기에도 쓰이지 않는다", async () => {
    const { db } = makeDb([row({ id: "x1", topicKeys: ["golf-trip"] })]);
    expect(await pickMediaForTopic("season-guide", 3, db)).toEqual([]);
  });

  it("덜 쓴 사진을 먼저 고른다", async () => {
    const { db } = makeDb([
      row({ id: "old", topicKeys: ["golf-trip"], usedCount: 5 }),
      row({ id: "fresh", topicKeys: ["golf-trip"], usedCount: 0 }),
    ]);
    const picked = await pickMediaForTopic("golf-trip", 1, db);
    expect(picked.map((p) => p.id)).toEqual(["fresh"]);
  });

  it("주제 일치분만으로 정원이 차면 범용을 조회하지 않는다", async () => {
    const { db, calls } = makeDb([
      row({ id: "m1", topicKeys: ["food-and-market"] }),
      row({ id: "m2", topicKeys: ["food-and-market"], usedCount: 1 }),
      row({ id: "g1" }),
    ]);
    const picked = await pickMediaForTopic("food-and-market", 2, db);
    expect(picked.map((p) => p.id)).toEqual(["m1", "m2"]);
    expect(calls.wheres).toHaveLength(1); // 범용 조회 자체가 없었다
  });

  it("라이브러리가 비면 빈 배열 — 호출부는 사진 없이 진행한다", async () => {
    const { db } = makeDb([]);
    expect(await pickMediaForTopic("villa-vs-hotel", MAX_MEDIA_PER_ARTICLE, db)).toEqual([]);
  });
});

describe("본문 삽입", () => {
  const blocks = [
    { type: "p" as const, text: "리드 문단" },
    { type: "h2" as const, text: "첫 소제목" },
    { type: "p" as const, text: "첫 본문" },
    { type: "h2" as const, text: "둘째 소제목" },
    { type: "p" as const, text: "둘째 본문" },
  ];

  it("소제목 뒤 첫 문단 다음에 사진이 들어간다", () => {
    const out = interleaveImages(
      blocks,
      toPickedImages([{ id: "m1", url: "https://cdn.r2.dev/a.jpg", alt: "설명", caption: "캡션" }])
    );
    expect(out[3]).toEqual({ type: "img", url: "https://cdn.r2.dev/a.jpg", alt: "설명", caption: "캡션" });
  });

  it("caption이 없으면 키 자체를 넣지 않는다(파서 계약과 동일)", () => {
    expect(toPickedImages([{ id: "m1", url: "u", alt: "a", caption: null }])).toEqual([{ url: "u", alt: "a" }]);
  });

  it("사진이 없으면 본문이 그대로다", () => {
    expect(interleaveImages(blocks, [])).toEqual(blocks);
  });

  it("이미지는 분량으로 치지 않는다 — 사진으로 800자 하한을 우회할 수 없다", () => {
    const thin = [
      { type: "h2" as const, text: "제목" },
      { type: "p" as const, text: "짧은 본문" },
    ];
    const withImages = interleaveImages(
      thin,
      toPickedImages([{ id: "m1", url: "https://cdn.r2.dev/a.jpg", alt: "설명", caption: null }])
    );
    expect(bodyTextLength(withImages)).toBe(bodyTextLength(thin));
    expect(isArticlePublishable(withImages)).toBe(false);
  });
});

describe("입력 검증", () => {
  it("주제 키는 사전에 있는 값만 남긴다", () => {
    expect(normalizeTopicKeys(["golf-trip", "없는주제", "golf-trip", 3])).toEqual(["golf-trip"]);
    expect(normalizeTopicKeys(undefined)).toEqual([]);
  });

  it("alt 없으면 저장을 막는다", () => {
    expect(validateMediaInput({ url: "https://cdn.r2.dev/a.jpg", alt: "" })).toEqual({
      ok: false,
      error: "ALT_REQUIRED",
    });
  });

  it("허용 호스트 밖 URL은 막는다", () => {
    expect(validateMediaInput({ url: "https://evil.example.com/a.jpg", alt: "설명" })).toEqual({
      ok: false,
      error: "URL_NOT_ALLOWED",
    });
    expect(validateMediaInput({ url: "https://cdn.r2.dev/a.jpg", alt: "설명" })).toEqual({ ok: true });
  });
});
