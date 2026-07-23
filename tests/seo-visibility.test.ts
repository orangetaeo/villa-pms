// tests/seo-visibility.test.ts — 발행 글 노출/비노출 (T-seo-ux-fix 지적 6)
//
// 여기서 지키는 것: 비노출로 내린 글이 **공개 진입점 두 곳 모두**에서 걸러진다.
// 이 둘이 공개 라우트·sitemap·RSS가 공유하는 단일 진입점이라, 여기만 막으면 전부 막힌다.
import { describe, it, expect } from "vitest";
import { getPublishedArticles, getPublishedArticleBySlug } from "@/lib/seo/article";
import type { DbClient } from "@/lib/availability";

function makeDb() {
  const calls: { findMany?: unknown; findFirst?: unknown } = {};
  const db = {
    seoArticle: {
      findMany: async (args: unknown) => {
        calls.findMany = args;
        return [];
      },
      findFirst: async (args: unknown) => {
        calls.findFirst = args;
        return null;
      },
    },
  } as unknown as DbClient;
  return { db, calls };
}

describe("비노출 글은 공개에서 빠진다", () => {
  it("목록 조회에 publicHidden: false 조건이 걸린다", async () => {
    const { db, calls } = makeDb();
    await getPublishedArticles(db);
    expect((calls.findMany as { where: Record<string, unknown> }).where).toMatchObject({
      status: "PUBLISHED",
      publicHidden: false,
    });
  });

  it("슬러그 단건 조회에도 같은 조건이 걸린다", async () => {
    const { db, calls } = makeDb();
    await getPublishedArticleBySlug("place-restaurant-1", db);
    expect((calls.findFirst as { where: Record<string, unknown> }).where).toMatchObject({
      slug: "place-restaurant-1",
      status: "PUBLISHED",
      publicHidden: false,
    });
  });
});
