// lib/seo/related-articles.ts — 블로그 글 상세 하단 "관련 글" 내부 링크 (SEO 품질 신호)
//
// 왜 필요한가: 내부 링크는 ⑴크롤러가 사이트 구조·주제 군집을 이해하는 신호이고
//   ⑵독자를 다음 글로 이어 체류시간·PV를 늘린다. 억지 링크는 오히려 신호를 흐리므로,
//   관련도 높은 순으로 최대 몇 개만 뽑고 못 뽑으면 빈 배열(호출부가 섹션을 숨긴다).
//
// ★ 공개 경계 승계: 후보는 **오직** getPublishedArticles(PUBLISHED·publicHidden=false 게이트)를
//   경유해서 얻는다. SeoArticle엔 가격·공급자·공실 같은 민감 필드가 없어 카드 필드는 그대로 안전하다.
// ★ 결정적(deterministic): Math.random 금지. 후보는 이미 publishedAt desc로 정렬돼 오므로
//   우선순위 티어로 재배치만 하며, 티어 내부 순서는 최신순이 유지된다.
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import type { SeoArticleCategory } from "@/lib/seo/categories";
import { getPublishedArticles, type PublicArticle } from "@/lib/seo/article";

/** 관련 글 카드 최대 노출 수 — 하단 섹션은 4개까지(집중도·스크롤). */
export const MAX_RELATED_ARTICLES = 4;
/** 후보 풀 크기 — 이 안에서 우선순위로 추린다(최신 글 위주). */
const RELATED_CANDIDATE_POOL = 50;

/** 관련 글 카드 — 목록 카드에 필요한 최소 필드만(공개 DTO 부분집합). */
export interface RelatedArticleCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  thumbnailUrl: string | null;
  coverPhotoUrl: string | null;
  category: SeoArticleCategory;
  publishedAt: Date;
}

function toCard(a: PublicArticle): RelatedArticleCard {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    thumbnailUrl: a.thumbnailUrl,
    coverPhotoUrl: a.coverPhotoUrl,
    category: a.category,
    publishedAt: a.publishedAt,
  };
}

const normArea = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** 선정 입력 — 글에서 필요한 최소 필드만. */
export interface RelatedInput {
  id: string;
  category: SeoArticleCategory;
}

/**
 * 관련 글 선정(최대 MAX_RELATED_ARTICLES). 우선순위 티어(중복 없이, 각 티어 내부는 최신순):
 *   1) (장소 글) 같은 area의 다른 장소 글  — 지역 군집 신호가 가장 강하다
 *   2) 같은 category의 다른 글
 *   3) 다른 category의 최신 글로 채움
 * 자기 자신·미발행·publicHidden은 getPublishedArticles 게이트에서 이미 배제된다.
 * 못 뽑으면 빈 배열 → 호출부가 섹션을 숨긴다(억지 링크 금지).
 */
export async function getRelatedArticles(
  article: RelatedInput,
  db: DbClient = prisma,
): Promise<RelatedArticleCard[]> {
  const pool = await getPublishedArticles(db, RELATED_CANDIDATE_POOL);
  const candidates = pool.filter((a) => a.id !== article.id);
  if (candidates.length === 0) return [];

  // 장소 글이면 area 매칭용으로 후보 장소 글 + 자기 자신의 area를 한 번에 조회한다.
  //   (getPlaceArticleMap은 지도 URL 해석에 네트워크를 타므로 area만 필요한 여기선 직접 조회)
  let selfArea: string | null = null;
  const areaByArticleId = new Map<string, string | null>();
  if (article.category === "place") {
    const placeIds = candidates.filter((a) => a.category === "place").map((a) => a.id);
    const ids = [article.id, ...placeIds];
    const places = await db.seoPlace.findMany({
      where: { usedInArticleId: { in: ids }, active: true },
      select: { usedInArticleId: true, area: true },
    });
    for (const p of places) {
      // 한 글에 여러 장소가 연결될 수 있다 — 첫 area만 대표로 쓴다(getRecommendedVillas와 동일 규약).
      if (p.usedInArticleId && !areaByArticleId.has(p.usedInArticleId)) {
        areaByArticleId.set(p.usedInArticleId, p.area);
      }
    }
    selfArea = normArea(areaByArticleId.get(article.id)) || null;
  }

  const sameAreaPlace: RelatedArticleCard[] = [];
  const sameCategory: RelatedArticleCard[] = [];
  const rest: RelatedArticleCard[] = [];

  for (const a of candidates) {
    const isSameAreaPlace =
      article.category === "place" &&
      a.category === "place" &&
      !!selfArea &&
      normArea(areaByArticleId.get(a.id)) === selfArea;
    if (isSameAreaPlace) sameAreaPlace.push(toCard(a));
    else if (a.category === article.category) sameCategory.push(toCard(a));
    else rest.push(toCard(a));
  }

  return [...sameAreaPlace, ...sameCategory, ...rest].slice(0, MAX_RELATED_ARTICLES);
}
