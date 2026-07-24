// tests/seo-related-articles.test.ts — 블로그 글 상세 하단 "관련 글" 선정 로직
//
// 검증 축:
//   1) 공개 게이트(getPublishedArticles: PUBLISHED·publicHidden=false)를 강제하고 자기 자신을 제외
//   2) 우선순위 티어(장소 같은area → 같은 category → 나머지 최신순) + 최대 개수
//   3) 결정적(같은 입력 → 같은 순서), 카드 DTO에 민감 필드 없음
import { describe, it, expect } from "vitest";
import { getRelatedArticles, MAX_RELATED_ARTICLES } from "@/lib/seo/related-articles";
import { SeoArticleStatus } from "@prisma/client";
import type { DbClient } from "@/lib/availability";
import type { SeoArticleCategory } from "@/lib/seo/categories";

// ── 픽스처 ──────────────────────────────────────────────────────────────────
interface ArticleSeed {
  id: string;
  category: SeoArticleCategory;
  /** publishedAt 오프셋(일) — 클수록 최신. */
  day: number;
  /** 장소 글이면 연결 area(seoPlace.usedInArticleId). */
  area?: string;
}

function bodyJson() {
  return [
    { type: "h2", text: "소제목" },
    { type: "p", text: "가".repeat(900) },
  ];
}

/**
 * DB 근사 스파이.
 *   · seoArticle.findMany: where(공개 게이트)를 calls에 기록하고, 게이트를 실제 존중해 필터·정렬(publishedAt desc)한다.
 *   · seoPlace.findMany: usedInArticleId.in 으로 area 반환(장소 글 area 매칭용).
 */
function makeDb(seeds: ArticleSeed[]) {
  const calls: { where: Record<string, unknown> }[] = [];
  const rows = seeds.map((s) => ({
    id: s.id,
    slug: `slug-${s.id}`,
    title: `제목 ${s.id}`,
    summary: `요약 ${s.id}`,
    bodyJson: bodyJson(),
    coverPhotoUrl: `/cover-${s.id}.jpg`,
    thumbnailUrl: null,
    category: s.category,
    relatedVillaIds: [],
    publishedAt: new Date(Date.UTC(2026, 6, 1 + s.day)),
    updatedAt: new Date(Date.UTC(2026, 6, 1 + s.day)),
    status: SeoArticleStatus.PUBLISHED,
    publicHidden: false,
  }));
  const db = {
    seoArticle: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        calls.push({ where: args.where });
        return rows
          .filter((r) => r.status === SeoArticleStatus.PUBLISHED && r.publishedAt !== null && r.publicHidden === false)
          .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      },
    },
    seoPlace: {
      findMany: async (args: { where: { usedInArticleId?: { in?: string[] } } }) => {
        const ids = args.where.usedInArticleId?.in ?? [];
        return seeds
          .filter((s) => s.area != null && ids.includes(s.id))
          .map((s) => ({ usedInArticleId: s.id, area: s.area! }));
      },
    },
  } as unknown as DbClient;
  return { db, calls };
}

const FORBIDDEN = ["price", "krw", "vnd", "cost", "margin", "deposit", "supplier", "cleaner", "address"];
function hasForbiddenField(obj: unknown): string[] {
  const json = JSON.stringify(obj).toLowerCase();
  return FORBIDDEN.filter((f) => json.includes(`"${f}`));
}

describe("getRelatedArticles — 공개 게이트 + 자기 제외", () => {
  it("자기 자신은 제외한다", async () => {
    const { db } = makeDb([
      { id: "SELF", category: "guide", day: 5 },
      { id: "A", category: "guide", day: 4 },
    ]);
    const out = await getRelatedArticles({ id: "SELF", category: "guide" }, db);
    expect(out.map((a) => a.id)).not.toContain("SELF");
    expect(out.map((a) => a.id)).toEqual(["A"]);
  });

  it("findMany where에 PUBLISHED·publicHidden=false 게이트를 강제한다", async () => {
    const { db, calls } = makeDb([
      { id: "SELF", category: "guide", day: 3 },
      { id: "A", category: "guide", day: 2 },
    ]);
    await getRelatedArticles({ id: "SELF", category: "guide" }, db);
    const w = calls[0].where;
    expect(w.status).toBe(SeoArticleStatus.PUBLISHED);
    expect(w.publicHidden).toBe(false);
    expect(w.publishedAt).toEqual({ not: null });
  });

  it("후보가 없으면 빈 배열(섹션 숨김)", async () => {
    const { db } = makeDb([{ id: "SELF", category: "guide", day: 1 }]);
    expect(await getRelatedArticles({ id: "SELF", category: "guide" }, db)).toEqual([]);
  });
});

describe("getRelatedArticles — 우선순위 티어", () => {
  it("같은 category를 다른 category보다 앞에 둔다(각 티어 최신순)", async () => {
    const { db } = makeDb([
      { id: "SELF", category: "guide", day: 10 },
      { id: "OTHER1", category: "service", day: 9 }, // 더 최신이지만 다른 카테고리
      { id: "GUIDE1", category: "guide", day: 8 },
      { id: "GUIDE2", category: "guide", day: 7 },
      { id: "OTHER2", category: "villa", day: 6 },
    ]);
    const out = await getRelatedArticles({ id: "SELF", category: "guide" }, db);
    // 같은 category(GUIDE1·GUIDE2 최신순) 먼저, 그 뒤 나머지 최신순(OTHER1·OTHER2)
    expect(out.map((a) => a.id)).toEqual(["GUIDE1", "GUIDE2", "OTHER1", "OTHER2"]);
  });

  it("장소 글: 같은 area 장소 글을 최우선(같은 category라도 area 우선)", async () => {
    const { db } = makeDb([
      { id: "SELF", category: "place", day: 10, area: "즈엉동" },
      { id: "PLACE_OTHER_AREA", category: "place", day: 9, area: "안터이" }, // 더 최신이지만 다른 area
      { id: "PLACE_SAME_AREA", category: "place", day: 8, area: "즈엉동" },
      { id: "GUIDE1", category: "guide", day: 7 },
    ]);
    const out = await getRelatedArticles({ id: "SELF", category: "place" }, db);
    // 같은 area(PLACE_SAME_AREA) → 나머지 같은 category place(PLACE_OTHER_AREA) → 다른 category(GUIDE1)
    expect(out.map((a) => a.id)).toEqual(["PLACE_SAME_AREA", "PLACE_OTHER_AREA", "GUIDE1"]);
  });

  it(`최대 ${MAX_RELATED_ARTICLES}개로 자른다`, async () => {
    const seeds: ArticleSeed[] = [{ id: "SELF", category: "guide", day: 20 }];
    for (let i = 0; i < 8; i++) seeds.push({ id: `A${i}`, category: "guide", day: 19 - i });
    const { db } = makeDb(seeds);
    const out = await getRelatedArticles({ id: "SELF", category: "guide" }, db);
    expect(out).toHaveLength(MAX_RELATED_ARTICLES);
  });

  it("결정적 — 같은 입력이면 같은 순서", async () => {
    const seeds: ArticleSeed[] = [
      { id: "SELF", category: "guide", day: 10 },
      { id: "A", category: "guide", day: 9 },
      { id: "B", category: "service", day: 8 },
      { id: "C", category: "guide", day: 7 },
    ];
    const r1 = await getRelatedArticles({ id: "SELF", category: "guide" }, makeDb(seeds).db);
    const r2 = await getRelatedArticles({ id: "SELF", category: "guide" }, makeDb(seeds).db);
    expect(r1.map((a) => a.id)).toEqual(r2.map((a) => a.id));
  });

  it("카드 DTO에 가격·공급자 등 민감 필드가 없다", async () => {
    const { db } = makeDb([
      { id: "SELF", category: "guide", day: 2 },
      { id: "A", category: "guide", day: 1 },
    ]);
    const out = await getRelatedArticles({ id: "SELF", category: "guide" }, db);
    expect(hasForbiddenField(out)).toEqual([]);
  });
});
