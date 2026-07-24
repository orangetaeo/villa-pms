// tests/seo-video-article.test.ts — 개별 영상 글(category="video") 발행 자격·원천 선정 회귀 (ADR-0049, QA)
//
// 여기서 지키는 것:
//  C5) 영상 글 발행 자격 — video 블록 1개 + h2 1개 + 텍스트 300자 하한(경계), 기존 800자 회귀 0
//  C1/C2/C3) ⑤ 브랜치 원천 선정 — ADR §4 조건(where) + topicKey 멱등(usedKeys) + publishedAt asc
import { describe, it, expect, vi } from "vitest";
import { isArticlePublishable, parseArticleBody, pickArticlesToPublish, MIN_ARTICLE_BODY_CHARS } from "@/lib/seo/article";
import { buildVideoObjectLd } from "@/lib/seo/article-jsonld";
import {
  getVideoArticleCandidates,
  videoTopicKey,
  composeVideoBody,
  extractClipSpaces,
  spaceLabelsKo,
} from "@/lib/seo/video-article-draft";
import type { DbClient } from "@/lib/availability";

const V = "dKxCN6DzMq4"; // 유효 ytVideoId 형식
const g = (n: number) => "가".repeat(n);

describe("C5 영상 글 발행 자격 — category='video' 분기", () => {
  // totalText = h2("제목",2자) + p 를 정확히 맞춘다. bodyTextLength는 h2+p 텍스트 합(영상=0).
  const H2 = "제목"; // 2자
  const body = (totalText: number, opts: { video?: boolean; h2?: boolean } = {}) => {
    const { video = true, h2 = true } = opts;
    const blocks: unknown[] = [];
    const h2Len = h2 ? H2.length : 0;
    if (h2) blocks.push({ type: "h2", text: H2 });
    blocks.push({ type: "p", text: g(Math.max(0, totalText - h2Len)) });
    if (video) blocks.push({ type: "video", ytVideoId: V, title: "영상" });
    return parseArticleBody(blocks);
  };

  it("video 블록 + h2 + 300자면 발행 가능", () => {
    expect(isArticlePublishable(body(300), "video")).toBe(true);
  });

  it("경계: 299자면 발행 불가 (300자 하한)", () => {
    expect(isArticlePublishable(body(299), "video")).toBe(false);
  });

  it("video 블록이 없으면 텍스트가 충분해도 발행 불가", () => {
    expect(isArticlePublishable(body(500, { video: false }), "video")).toBe(false);
  });

  it("h2가 없으면 발행 불가", () => {
    expect(isArticlePublishable(body(500, { h2: false }), "video")).toBe(false);
  });

  it("영상은 분량으로 세지 않는다 — 미디어 도배로 300자 하한 우회 불가", () => {
    // 텍스트 100자 + video 블록만 → 영상=0자 규칙이라 하한 미달
    expect(isArticlePublishable(body(100), "video")).toBe(false);
  });

  it("회귀: category 없이 부르면 기존 800자 규칙 그대로 (video 하한 누출 없음)", () => {
    // 400자 + h2 → video 하한(300)은 넘지만 기존 규칙(800)에는 미달이어야 한다
    const blocks = parseArticleBody([
      { type: "h2", text: "제목" },
      { type: "p", text: g(400) },
    ]);
    expect(isArticlePublishable(blocks)).toBe(false);
    expect(isArticlePublishable(blocks, undefined)).toBe(false);
    const long = parseArticleBody([
      { type: "h2", text: "제목" },
      { type: "p", text: g(MIN_ARTICLE_BODY_CHARS) },
    ]);
    expect(isArticlePublishable(long)).toBe(true);
    // 같은 800자 텍스트 글에 category="video"를 잘못 줘도 video 블록이 없으니 발행 불가(구조 게이트)
    expect(isArticlePublishable(long, "video")).toBe(false);
  });
});

describe("composeVideoBody — video 블록 항상 1개 보장", () => {
  it("도입 문단(첫 p) 바로 뒤에 video를 끼운다", () => {
    const blocks = parseArticleBody([
      { type: "p", text: "도입" },
      { type: "h2", text: "소제목" },
      { type: "ul", items: ["a", "b"] },
      { type: "p", text: "마무리" },
    ]);
    const out = composeVideoBody(blocks, { ytVideoId: V, title: "영상" });
    expect(out[0]).toEqual({ type: "p", text: "도입" });
    expect(out[1]).toEqual({ type: "video", ytVideoId: V, title: "영상" });
    expect(out.filter((b) => b.type === "video")).toHaveLength(1);
  });

  it("도입 문단이 없으면 맨 앞에 video를 둔다 (발행 자격 보장)", () => {
    const blocks = parseArticleBody([{ type: "h2", text: "소제목" }, { type: "ul", items: ["a"] }]);
    const out = composeVideoBody(blocks, { ytVideoId: V, title: "영상" });
    expect(out[0]).toEqual({ type: "video", ytVideoId: V, title: "영상" });
  });
});

describe("C1/C2/C3 ⑤ 브랜치 원천 선정 — where 조건 + 멱등 + 정렬", () => {
  function fakeDb(rows: { id: string }[]) {
    const findMany = vi.fn().mockResolvedValue(rows);
    return { db: { youtubeShort: { findMany } } as unknown as DbClient, findMany };
  }

  it("C3: findMany where가 ADR §4 조건(PUBLISHED·ytVideoId≠null·UPLOADED·villaId≠null)을 강제한다", async () => {
    const { db, findMany } = fakeDb([]);
    await getVideoArticleCandidates(new Set(), db);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      status: "PUBLISHED",
      ytVideoId: { not: null },
      sourceType: "UPLOADED",
      villaId: { not: null },
    });
    // VILLA_AUTO·PLACE_AUTO·미업로드·villaId null 은 where에서 원천 제외 (Postgres가 필터)
    expect(arg.where.sourceType).toBe("UPLOADED");
    expect(arg.orderBy).toEqual({ publishedAt: "asc" }); // 오래된 것부터 백필
  });

  it("C2: 이미 글이 있는 쇼츠(topicKey video-<id> ∈ usedKeys)는 후보에서 제외된다 (멱등)", async () => {
    const rows = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    const { db } = fakeDb(rows);
    const used = new Set([videoTopicKey("s2")]); // s2는 이미 글이 있음
    const out = await getVideoArticleCandidates(used, db);
    expect(out.map((r) => r.id)).toEqual(["s1", "s3"]);
  });

  it("C1: 조건 충족·미생성 쇼츠가 있으면 후보로 나온다 (실행당 [0] 1건 소비)", async () => {
    const rows = [{ id: "s1" }, { id: "s2" }];
    const { db } = fakeDb(rows);
    const out = await getVideoArticleCandidates(new Set(), db);
    expect(out.length).toBe(2);
    expect(out[0].id).toBe("s1"); // 크론은 [0]만 생성 → 실행당 1건
  });

  it("C2: 두 후보가 모두 usedKeys에 있으면 후보 0 (2회차 재생성 없음)", async () => {
    const rows = [{ id: "s1" }, { id: "s2" }];
    const { db } = fakeDb(rows);
    const used = new Set([videoTopicKey("s1"), videoTopicKey("s2")]);
    expect(await getVideoArticleCandidates(used, db)).toHaveLength(0);
  });
});

describe("C6 buildVideoObjectLd — duration 3케이스 (PT#S / 키 부재 / 0 금지)", () => {
  const base = {
    title: "영상 글",
    summary: "요약",
    slug: "video-x",
    ytVideoId: V,
    coverPhotoUrl: "https://pub-abc.r2.dev/poster.jpg" as string | null,
    publishedAt: new Date("2026-07-23T00:00:00Z"),
  };

  it("durationSec 양수면 duration=PT#S", () => {
    const ld = buildVideoObjectLd({ ...base, durationSec: 88 });
    expect(ld.duration).toBe("PT88S");
    expect(ld["@type"]).toBe("VideoObject");
    expect(ld.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${V}`);
    expect(ld.thumbnailUrl).toBe("https://pub-abc.r2.dev/poster.jpg");
  });

  it("durationSec null이면 duration 키 자체가 없다 (PT0S 금지)", () => {
    const ld = buildVideoObjectLd({ ...base, durationSec: null });
    expect("duration" in ld).toBe(false);
  });

  it("durationSec 0이면 duration 키 없음 (거짓 값 방지)", () => {
    const ld = buildVideoObjectLd({ ...base, durationSec: 0 });
    expect("duration" in ld).toBe(false);
  });

  it("커버가 없거나 자사 정적이면 thumbnailUrl은 유튜브 썸네일 폴백", () => {
    const ld = buildVideoObjectLd({ ...base, coverPhotoUrl: null, durationSec: 88 });
    expect(ld.thumbnailUrl).toBe(`https://i.ytimg.com/vi/${V}/hqdefault.jpg`);
  });
});

describe("C4 pickArticlesToPublish — category를 발행 게이트로 전달 (video 영구 미발행 방지)", () => {
  it("APPROVED 글의 category를 함께 실어 반환한다 (video는 그대로, 미지값은 undefined)", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "a1", slug: "video-x", title: "영상 글", bodyJson: [], category: "video" },
      { id: "a2", slug: "guide-y", title: "가이드", bodyJson: [], category: "guide" },
      { id: "a3", slug: "z", title: "오염", bodyJson: [], category: "bogus" },
    ]);
    const db = { seoArticle: { findMany } } as unknown as DbClient;
    const out = await pickArticlesToPublish(5, db);
    // status=APPROVED만, category 무관하게 선정 (video도 대상)
    expect(findMany.mock.calls[0][0].where).toEqual({ status: "APPROVED" });
    expect(out.map((r) => r.category)).toEqual(["video", "guide", undefined]);
    // ★ 이 category가 seo-publish에서 isArticlePublishable(blocks, category)로 전달돼 video는 300자 게이트를 탄다.
    //   category가 빠지면 video 글이 800자 게이트에서 영구히 발행 안 되는 회귀가 여기서 잡힌다.
  });

  it("quota<=0이면 빈 배열 (조회 안 함)", async () => {
    const findMany = vi.fn();
    const db = { seoArticle: { findMany } } as unknown as DbClient;
    expect(await pickArticlesToPublish(0, db)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("extractClipSpaces / spaceLabelsKo — 방어적 파싱", () => {
  it("editParamsJson.clips[].space를 뽑는다", () => {
    expect(extractClipSpaces({ clips: [{ space: "POOL" }, { space: "BEDROOM" }] })).toEqual(["POOL", "BEDROOM"]);
  });
  it("형식이 다르면 빈 배열", () => {
    expect(extractClipSpaces(null)).toEqual([]);
    expect(extractClipSpaces({ clips: "x" })).toEqual([]);
    expect(extractClipSpaces({})).toEqual([]);
  });
  it("공간 코드 → 한국어 라벨(중복 제거·순서 보존, 미지 코드 버림)", () => {
    expect(spaceLabelsKo(["POOL", "pool", "BEDROOM", "ZZZ"])).toEqual(["수영장", "침실"]);
  });
});
