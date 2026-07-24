// lib/seo/recommended-villas.ts — 블로그 글 하단 "추천 빌라" 선정 (서버 전용)
//
// 운영자 요청: "해당 지역의 블로그 글이라면 빌라 추천". 글 성격별로 추천 출처가 다르다.
//
// ★ 공개 경계 승계: 빌라는 **오직** lib/seo/public-villa.ts 관문(getPublicVillas·getPublicVillasByIds)을
//   경유해서만 얻는다. Villa 모델 직접 조회 금지 — 판매가·원가·공실·공급자·정확주소가 새지 않게
//   PUBLIC_WHERE + 발행 자격 게이트를 그대로 상속한다.
// ★ 억지 추천 금지: 아래 규칙으로 못 뽑으면 빈 배열 → 호출부(page.tsx)가 섹션을 통째로 숨긴다.
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import type { SeoArticleCategory } from "@/lib/seo/categories";
import { getPublicVillas, getPublicVillasByIds, type PublicVilla } from "@/lib/seo/public-villa";

/** 카드 최대 노출 수 — 하단 섹션은 3장까지만(스크롤·집중도). */
export const MAX_RECOMMENDED_VILLAS = 3;

/**
 * 장소 글의 자유텍스트 area(즈엉동·안터이 등)와 공개 빌라의 지역 표기를 best-effort 매칭.
 * ComplexArea.code는 라틴 슬러그라 자유텍스트와 정확히 맞지 않으므로, 표시용 지역명
 * (areaNameKo·areaName·complex)에 대해 양방향 부분일치로 느슨하게 맞춘다.
 * ★ nameKo는 표시 전용(매칭 사용 금지) 원칙이 있으나, 여기서는 조회 조건이 아니라 이미 관문을
 *   통과한 공개 DTO를 화면 큐레이션 목적으로 거르는 것이라 표시명 매칭이 허용된다(누수 없음).
 */
function matchByPlaceArea(villas: PublicVilla[], area: string | null | undefined): PublicVilla[] {
  const q = (area ?? "").trim().toLowerCase();
  if (!q) return [];
  return villas.filter((v) => {
    const hay = [v.areaNameKo, v.areaName, v.complex]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.toLowerCase());
    return hay.some((h) => h.includes(q) || q.includes(h));
  });
}

/** 추천 빌라 선정 입력 — 글에서 필요한 최소 필드만. */
export interface RecommendInput {
  id: string;
  category: SeoArticleCategory;
  relatedVillaIds: string[];
}

/**
 * 글 성격별 추천 빌라(최대 3장). 출처 우선순위:
 *   1) place 글 — 그 장소의 area와 매칭되는 공개 빌라(자유텍스트 best-effort)
 *   2) villa 글 — 같은 지역(complexArea)의 **다른** 공개 빌라(자기 자신 제외)
 *   3) 그 외(guide 등) — relatedVillaIds로 공개 빌라 조회
 *   공통 폴백: 위에서 0개면 relatedVillaIds 시도. 그래도 0개면 빈 배열(섹션 숨김).
 */
export async function getRecommendedVillas(
  article: RecommendInput,
  db: DbClient = prisma,
): Promise<PublicVilla[]> {
  const { category, id, relatedVillaIds } = article;
  let picks: PublicVilla[] = [];

  if (category === "place") {
    // 장소 글: 연결된 SeoPlace(usedInArticleId)의 area로 지역 빌라를 뽑는다.
    const place = await db.seoPlace.findFirst({
      where: { usedInArticleId: id, active: true },
      select: { area: true },
    });
    if (place?.area) {
      const all = await getPublicVillas(db);
      picks = matchByPlaceArea(all, place.area);
    }
  } else if (category === "villa") {
    // 빌라 글: relatedVillaIds[0]이 이 글의 빌라(자기 자신). 같은 지역의 다른 빌라를 추천한다.
    const selfId = relatedVillaIds[0];
    if (selfId) {
      const all = await getPublicVillas(db);
      const self = all.find((v) => v.id === selfId);
      if (self?.areaCode) {
        picks = all.filter((v) => v.id !== selfId && v.areaCode === self.areaCode);
      }
    }
  }

  // 공통 폴백 — 위 규칙으로 못 뽑았으면 relatedVillaIds로 공개 빌라를 시도한다.
  if (picks.length === 0 && relatedVillaIds.length > 0) {
    const selfId = category === "villa" ? relatedVillaIds[0] : undefined;
    const byIds = await getPublicVillasByIds(relatedVillaIds, db);
    picks = byIds.filter((v) => v.id !== selfId);
  }

  return picks.slice(0, MAX_RECOMMENDED_VILLAS);
}
