// tests/seo-article.test.ts — 가이드 글 파싱·발행 자격·점진 발행 상한 (T-seo-s3)
//
// 여기서 지키는 것:
//  1) Gemini 산출물(미신뢰 JSON)을 렌더 전에 엄격히 거른다 — 형식 밖은 버리고 throw하지 않는다
//  2) 얇은 글은 발행하지 않는다
//  3) ★ 하루 발행 상한을 절대 넘지 않는다 — 대량 자동생성 스팸 시그널 차단
import { describe, it, expect } from "vitest";
import {
  parseArticleBody,
  bodyTextLength,
  isArticlePublishable,
  kstDayBoundsUtc,
  getPublishPerDay,
  remainingPublishQuota,
  pickArticlesToPublish,
  MIN_ARTICLE_BODY_CHARS,
  DEFAULT_PUBLISH_PER_DAY,
  MAX_PUBLISH_PER_DAY,
  isAllowedImageUrl,
} from "@/lib/seo/article";
import { pickArticleImages, interleaveImages } from "@/lib/seo/article-draft";
import type { DbClient } from "@/lib/availability";

describe("본문 블록 파싱 — 미신뢰 입력 방어", () => {
  it("허용 타입만 통과시키고 나머지는 버린다", () => {
    const raw = [
      { type: "h2", text: "제목" },
      { type: "p", text: "문단" },
      { type: "ul", items: ["가", "나"] },
      { type: "script", text: "alert(1)" }, // 허용 밖
      { type: "p", text: "   " }, // 빈 텍스트
      { type: "ul", items: [] }, // 빈 목록
      null,
      "문자열",
    ];
    expect(parseArticleBody(raw)).toEqual([
      { type: "h2", text: "제목" },
      { type: "p", text: "문단" },
      { type: "ul", items: ["가", "나"] },
    ]);
  });

  it("배열이 아니면 빈 배열 — throw하지 않는다", () => {
    expect(parseArticleBody(null)).toEqual([]);
    expect(parseArticleBody({ type: "p" })).toEqual([]);
    expect(parseArticleBody("본문")).toEqual([]);
  });

  it("ul 항목 중 문자열이 아닌 것은 걸러낸다", () => {
    const out = parseArticleBody([{ type: "ul", items: ["가", 3, null, "나"] }]);
    expect(out).toEqual([{ type: "ul", items: ["가", "나"] }]);
  });

  it("본문 길이는 텍스트 기준으로 센다", () => {
    expect(bodyTextLength([{ type: "h2", text: "1234" }, { type: "ul", items: ["12", "345"] }])).toBe(9);
  });
});

describe("발행 자격 — 얇은 글 차단", () => {
  const long = (n: number) => "가".repeat(n);

  it("분량 하한 미달이면 발행하지 않는다", () => {
    const blocks = parseArticleBody([
      { type: "h2", text: "제목" },
      { type: "p", text: long(MIN_ARTICLE_BODY_CHARS - 100) },
    ]);
    expect(isArticlePublishable(blocks)).toBe(false);
  });

  it("분량은 충족해도 소제목(h2)이 없으면 발행하지 않는다", () => {
    const blocks = parseArticleBody([{ type: "p", text: long(MIN_ARTICLE_BODY_CHARS + 100) }]);
    expect(isArticlePublishable(blocks)).toBe(false);
  });

  it("분량·구조 모두 충족하면 발행한다", () => {
    const blocks = parseArticleBody([
      { type: "h2", text: "제목" },
      { type: "p", text: long(MIN_ARTICLE_BODY_CHARS) },
    ]);
    expect(isArticlePublishable(blocks)).toBe(true);
  });
});

describe("KST 하루 경계", () => {
  it("KST 00:30은 그날 시작이 UTC 전날 15:00", () => {
    // 2026-07-22 00:30 KST = 2026-07-21 15:30 UTC
    const { start, end } = kstDayBoundsUtc(new Date("2026-07-21T15:30:00Z"));
    expect(start.toISOString()).toBe("2026-07-21T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-22T15:00:00.000Z");
  });

  it("KST 23:30도 같은 하루에 속한다", () => {
    const { start } = kstDayBoundsUtc(new Date("2026-07-22T14:30:00Z"));
    expect(start.toISOString()).toBe("2026-07-21T15:00:00.000Z");
  });
});

// ── 점진 발행 ────────────────────────────────────────────────────────────────
function makeDb(opts: { setting?: string | null; publishedToday?: number; approved?: number }) {
  const calls: { countWhere?: unknown; findArgs?: unknown } = {};
  const db = {
    appSetting: {
      findUnique: async () => (opts.setting === undefined ? null : opts.setting === null ? null : { value: opts.setting }),
    },
    seoArticle: {
      count: async (args: { where: unknown }) => {
        calls.countWhere = args.where;
        return opts.publishedToday ?? 0;
      },
      findMany: async (args: unknown) => {
        calls.findArgs = args;
        return Array.from({ length: opts.approved ?? 0 }, (_, i) => ({
          id: `a${i}`,
          slug: `s${i}`,
          title: `t${i}`,
          bodyJson: [],
        }));
      },
    },
  } as unknown as DbClient;
  return { db, calls };
}

describe("점진 발행 상한 — 대량 자동생성 스팸 차단", () => {
  const now = new Date("2026-07-22T02:00:00Z");

  it("설정이 없으면 기본 상한을 쓴다", async () => {
    const { db } = makeDb({});
    expect(await getPublishPerDay(db)).toBe(DEFAULT_PUBLISH_PER_DAY);
  });

  it("설정값이 하드 천장을 넘으면 클램프한다 (자기-스팸 방지)", async () => {
    const { db } = makeDb({ setting: "9999" });
    expect(await getPublishPerDay(db)).toBe(MAX_PUBLISH_PER_DAY);
  });

  it("오늘 이미 상한만큼 발행했으면 잔여 0", async () => {
    const { db } = makeDb({ setting: "5", publishedToday: 5 });
    expect(await remainingPublishQuota(now, db)).toBe(0);
  });

  it("일부만 발행했으면 잔여는 차액", async () => {
    const { db } = makeDb({ setting: "5", publishedToday: 2 });
    expect(await remainingPublishQuota(now, db)).toBe(3);
  });

  it("상한을 0으로 두면 발행이 완전히 멈춘다 (킬스위치)", async () => {
    const { db } = makeDb({ setting: "0", publishedToday: 0 });
    expect(await remainingPublishQuota(now, db)).toBe(0);
  });

  it("★ 잔여가 0이면 발행 후보를 아예 조회하지 않는다", async () => {
    const { db, calls } = makeDb({ approved: 10 });
    expect(await pickArticlesToPublish(0, db)).toEqual([]);
    expect(calls.findArgs).toBeUndefined();
  });

  it("발행 후보는 잔여 수만큼, 승인 오래된 순으로 가져온다", async () => {
    const { db, calls } = makeDb({ approved: 3 });
    const picked = await pickArticlesToPublish(3, db);
    expect(picked).toHaveLength(3);
    const args = calls.findArgs as { take: number; orderBy: unknown; where: { status: string } };
    expect(args.take).toBe(3);
    expect(args.orderBy).toEqual({ approvedAt: "asc" });
    expect(args.where.status).toBe("APPROVED");
  });

  it("발행 집계는 KST 하루 경계로 센다", async () => {
    const { db, calls } = makeDb({ setting: "5", publishedToday: 0 });
    await remainingPublishQuota(new Date("2026-07-22T02:00:00Z"), db);
    const where = calls.countWhere as { publishedAt: { gte: Date; lt: Date }; status: string };
    expect(where.status).toBe("PUBLISHED");
    expect(where.publishedAt.gte.toISOString()).toBe("2026-07-21T15:00:00.000Z");
  });
});

// ── 이미지 (T-seo-s3 이미지 SEO 보강) ────────────────────────────────────────
describe("본문 이미지 — 허용 호스트·alt 강제", () => {
  const OK = "https://pub-abc.r2.dev/villa/exterior.jpg";

  it("허용 호스트 + alt가 있으면 통과한다", () => {
    expect(parseArticleBody([{ type: "img", url: OK, alt: "쏘나씨 V12 외관" }])).toEqual([
      { type: "img", url: OK, alt: "쏘나씨 V12 외관" },
    ]);
  });

  it("★ 허용 밖 외부 호스트는 버린다 (추적 벡터·깨진 이미지 차단)", () => {
    for (const bad of [
      "https://evil.example/x.jpg",
      "http://pub-abc.r2.dev/x.jpg", // http
      "//cdn.other/x.jpg",
      "javascript:alert(1)",
    ]) {
      expect(parseArticleBody([{ type: "img", url: bad, alt: "설명" }])).toEqual([]);
    }
  });

  it("alt가 없으면 버린다 (빈 alt 이미지는 SEO·접근성 양쪽에 무의미)", () => {
    expect(parseArticleBody([{ type: "img", url: OK, alt: "" }])).toEqual([]);
    expect(parseArticleBody([{ type: "img", url: OK }])).toEqual([]);
  });

  it("자사 루트 상대경로(브랜드 자산)는 허용한다", () => {
    expect(isAllowedImageUrl("/og-villa-go.png")).toBe(true);
    expect(isAllowedImageUrl("//evil.example/x.png")).toBe(false);
  });

  it("★ 이미지는 분량으로 치지 않는다 (이미지 도배로 글자수 하한 우회 차단)", () => {
    const blocks = parseArticleBody([
      { type: "h2", text: "제목" },
      ...Array.from({ length: 20 }, () => ({ type: "img", url: OK, alt: "가".repeat(100) })),
    ]);
    expect(blocks.filter((b) => b.type === "img")).toHaveLength(20);
    expect(bodyTextLength(blocks)).toBe(2); // h2 "제목"만 계산
    expect(isArticlePublishable(blocks)).toBe(false);
  });

  it("캡션은 분량에 포함된다", () => {
    const blocks = parseArticleBody([{ type: "img", url: OK, alt: "a", caption: "1234" }]);
    expect(bodyTextLength(blocks)).toBe(4);
  });
});

describe("이미지 선별·삽입", () => {
  function villa(over = {}) {
    return {
      id: "v1", slug: "s1", name: "V12", nameVi: null, complex: "Sonasea",
      areaCode: "sonasea", areaName: "Sonasea", areaNameKo: "쏘나씨",
      bedrooms: 4, bathrooms: 4, commonBathrooms: 1, maxGuests: 10,
      areaSqm: null, floors: null, extraBedAvailable: false, hasPool: true,
      breakfastAvailable: false, beachDistanceM: null, featureKeys: [],
      checkInTime: 840, checkOutTime: 660, smokingAllowed: false, petsAllowed: false,
      partyAllowed: false, parkingSlots: 0, description: null,
      photos: [
        { id: "p1", url: "https://pub-abc.r2.dev/1.jpg", space: "BEDROOM", spaceLabel: null },
        { id: "p2", url: "https://pub-abc.r2.dev/2.jpg", space: "EXTERIOR", spaceLabel: null },
        { id: "p3", url: "https://pub-abc.r2.dev/3.jpg", space: "POOL", spaceLabel: null },
      ],
      videos: [], updatedAt: new Date(), publicListedAt: null,
      ...over,
    };
  }

  it("공간 우선순위(외관→수영장)대로 중복 없이 고르고 한국어 alt를 만든다", () => {
    const picks = pickArticleImages([villa() as never], 3);
    expect(picks.map((p) => p.url)).toEqual([
      "https://pub-abc.r2.dev/2.jpg", // EXTERIOR
      "https://pub-abc.r2.dev/3.jpg", // POOL
      "https://pub-abc.r2.dev/1.jpg", // BEDROOM
    ]);
    expect(picks[0].alt).toBe("쏘나씨 V12 외관");
  });

  it("공개 빌라가 없으면 빈 배열 — 외부 스톡 이미지를 끌어오지 않는다", () => {
    expect(pickArticleImages([], 3)).toEqual([]);
  });

  it("이미지는 소제목 뒤 첫 문단 다음에 삽입된다", () => {
    const blocks = [
      { type: "h2", text: "A" },
      { type: "p", text: "a1" },
      { type: "p", text: "a2" },
      { type: "h2", text: "B" },
      { type: "p", text: "b1" },
    ] as never;
    const out = interleaveImages(blocks, [{ url: "https://pub-abc.r2.dev/1.jpg", alt: "x" }]);
    expect(out.map((b) => b.type)).toEqual(["h2", "p", "img", "p", "h2", "p"]);
  });

  it("이미지가 없으면 본문을 그대로 둔다", () => {
    const blocks = [{ type: "h2", text: "A" }] as never;
    expect(interleaveImages(blocks, [])).toBe(blocks);
  });
});
