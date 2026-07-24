// 계약 D — getPublishedArticleForVilla: 빌라→발행글 역조회(category='villa' 우선·미발행 제외).
// db 클라이언트를 주입받으므로 prisma 전역 mock 없이 findFirst 스텁으로 검증한다.
import { describe, expect, it, vi } from "vitest";
import { SeoArticleStatus } from "@prisma/client";
import { getPublishedArticleForVilla } from "./article";
import type { DbClient } from "@/lib/availability";

function dbWith(findFirst: ReturnType<typeof vi.fn>): DbClient {
  return { seoArticle: { findFirst } } as unknown as DbClient;
}

describe("getPublishedArticleForVilla", () => {
  it("category='villa' 글을 우선 반환(폴백 조회는 하지 않음)", async () => {
    const findFirst = vi.fn((_arg: { where: Record<string, unknown> }) =>
      Promise.resolve({ slug: "villa-slug", title: "빌라 소개" })
    );
    const db = dbWith(findFirst);

    const out = await getPublishedArticleForVilla("villa1", db);
    expect(out).toEqual({ slug: "villa-slug", title: "빌라 소개" });
    // villa 우선 조회 1회로 끝(폴백 미호출)
    expect(findFirst).toHaveBeenCalledTimes(1);
    const arg = findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      status: SeoArticleStatus.PUBLISHED,
      publishedAt: { not: null },
      publicHidden: false,
      relatedVillaIds: { has: "villa1" },
      category: "villa",
    });
  });

  it("villa 글이 없으면 카테고리 무관 발행글로 폴백", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null) // villa 우선 조회 → 없음
      .mockResolvedValueOnce({ slug: "guide-slug", title: "가이드 글" }); // 폴백
    const db = dbWith(findFirst);

    const out = await getPublishedArticleForVilla("villa1", db);
    expect(out).toEqual({ slug: "guide-slug", title: "가이드 글" });
    expect(findFirst).toHaveBeenCalledTimes(2);
    // 폴백 조회 where에는 category 조건이 없다(공개 게이트 + relatedVillaIds만)
    const fallbackArg = findFirst.mock.calls[1][0] as { where: Record<string, unknown> };
    expect(fallbackArg.where).not.toHaveProperty("category");
    expect(fallbackArg.where).toMatchObject({ relatedVillaIds: { has: "villa1" } });
  });

  it("발행글이 하나도 없으면 null", async () => {
    const findFirst = vi.fn(async () => null);
    const out = await getPublishedArticleForVilla("villa1", dbWith(findFirst));
    expect(out).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});
