// lib/seo/facets.ts — 패싯(조건별) 공개 페이지 산출 (T-seo-s1)
//
// 소비자가 "지역·이용시설·인원"으로 찾아 들어오게 하려면 그 조건이 **URL을 가진 페이지**여야 한다.
// 쿼리스트링 필터는 크롤러가 색인하지 않는다. 여기서 "정적 경로로 승격할 패싯"을 결정한다.
//
// ★ 조합 폭발·얇은 콘텐츠 가드 (기획 §0 치명2):
//   · 매칭 빌라가 MIN_FACET_VILLAS 미만이면 **생성하지 않는다**(sitemap 미등재 + 페이지 404)
//   · 조합은 2단(지역×시설)까지만
//   빌라 2개 시점에는 대부분의 패싯이 생성되지 않는다 — 정상이며 의도된 동작이다.
//   빌라가 늘면 코드 변경 없이 자동으로 페이지가 열린다.
//
// ★ 날짜(공실) 패싯은 존재하지 않는다 — 원칙 1(재고 비공개). 여기에 절대 추가하지 말 것.
import { FEATURE_ITEMS, type FeatureCategoryKey } from "@/lib/features";
import { blogPaths } from "@/lib/seo/routes";
import type { PublicVilla } from "@/lib/seo/public-villa";

/** 패싯 페이지 생성 최소 매칭 수. 미만이면 껍데기 페이지가 되므로 만들지 않는다. */
export const MIN_FACET_VILLAS = 3;

/** 인원 버킷 — 한국 여행객 검색 패턴(가족·단체) 기준. 해당 인원 "이상 수용" 의미. */
export const GUEST_BUCKETS = [4, 6, 8, 10, 12, 16] as const;
/** 침실 버킷 — 해당 침실 수 "이상". */
export const BEDROOM_BUCKETS = [2, 3, 4, 5, 6] as const;

/** 사전에 등록된 전체 featureKey (임의 키 유입 차단 — URL 주입 방지) */
export const ALL_FEATURE_KEYS: string[] = (Object.keys(FEATURE_ITEMS) as FeatureCategoryKey[]).flatMap((c) =>
  FEATURE_ITEMS[c].map((f) => f.featureKey)
);

export type FacetKind = "area" | "feature" | "guests" | "bedrooms" | "areaFeature";

export interface FacetPage {
  kind: FacetKind;
  /** 공개 URL 경로 */
  path: string;
  /** 매칭 빌라 수 — 정렬·표시용 */
  count: number;
  /** 패싯 파라미터(페이지 렌더가 다시 필터링할 때 사용) */
  params: { area?: string; feature?: string; guests?: number; bedrooms?: number };
  /** 가장 최근 갱신 빌라 시각 — sitemap lastModified */
  lastModified: Date;
}

function lastMod(villas: PublicVilla[]): Date {
  return villas.reduce<Date>((acc, v) => (v.updatedAt > acc ? v.updatedAt : acc), new Date(0));
}

/** 지역(단지) 패싯 — ComplexArea.code 기준 */
export function areaFacets(villas: PublicVilla[], min: number = MIN_FACET_VILLAS): FacetPage[] {
  const byArea = new Map<string, PublicVilla[]>();
  for (const v of villas) {
    if (!v.areaCode) continue;
    const list = byArea.get(v.areaCode) ?? [];
    list.push(v);
    byArea.set(v.areaCode, list);
  }
  return [...byArea.entries()]
    .filter(([, list]) => list.length >= min)
    .map(([code, list]) => ({
      kind: "area" as const,
      path: blogPaths.area(code),
      count: list.length,
      params: { area: code },
      lastModified: lastMod(list),
    }));
}

/** 이용시설·특징 패싯 — 사전 화이트리스트 키만 */
export function featureFacets(villas: PublicVilla[], min: number = MIN_FACET_VILLAS): FacetPage[] {
  return ALL_FEATURE_KEYS.map((key) => {
    const list = villas.filter((v) => v.featureKeys.includes(key));
    return { key, list };
  })
    .filter(({ list }) => list.length >= min)
    .map(({ key, list }) => ({
      kind: "feature" as const,
      path: blogPaths.feature(key),
      count: list.length,
      params: { feature: key },
      lastModified: lastMod(list),
    }));
}

/** 인원 패싯 — maxGuests >= n */
export function guestFacets(villas: PublicVilla[], min: number = MIN_FACET_VILLAS): FacetPage[] {
  return GUEST_BUCKETS.map((n) => ({ n, list: villas.filter((v) => v.maxGuests >= n) }))
    .filter(({ list }) => list.length >= min)
    .map(({ n, list }) => ({
      kind: "guests" as const,
      path: blogPaths.guests(n),
      count: list.length,
      params: { guests: n },
      lastModified: lastMod(list),
    }));
}

/** 침실 패싯 — bedrooms >= n */
export function bedroomFacets(villas: PublicVilla[], min: number = MIN_FACET_VILLAS): FacetPage[] {
  return BEDROOM_BUCKETS.map((n) => ({ n, list: villas.filter((v) => v.bedrooms >= n) }))
    .filter(({ list }) => list.length >= min)
    .map(({ n, list }) => ({
      kind: "bedrooms" as const,
      path: blogPaths.bedrooms(n),
      count: list.length,
      params: { bedrooms: n },
      lastModified: lastMod(list),
    }));
}

/** 2단 조합(지역 × 시설) — 단일 패싯이 각각 살아있는 조합만 검토한다 */
export function areaFeatureFacets(villas: PublicVilla[], min: number = MIN_FACET_VILLAS): FacetPage[] {
  const areas = areaFacets(villas, min).map((f) => f.params.area!);
  const features = featureFacets(villas, min).map((f) => f.params.feature!);
  const out: FacetPage[] = [];
  for (const area of areas) {
    for (const feature of features) {
      const list = villas.filter((v) => v.areaCode === area && v.featureKeys.includes(feature));
      if (list.length < min) continue;
      out.push({
        kind: "areaFeature",
        path: blogPaths.areaFeature(area, feature),
        count: list.length,
        params: { area, feature },
        lastModified: lastMod(list),
      });
    }
  }
  return out;
}

/**
 * 전체 패싯 페이지 — sitemap·내부링크가 공유하는 단일 진입점.
 * ★ min: 매칭 빌라 하한. 기본 MIN_FACET_VILLAS(3)=사이트맵·색인·나브용(얇은 콘텐츠 제외).
 *   온사이트 필터(loadFacet)는 min=1로 호출해 빌라 1~2곳이어도 페이지가 열리게 한다(그 페이지는
 *   3곳 미만이면 라우트에서 noindex 처리 → 검색 색인은 여전히 막힌다).
 */
export function allFacetPages(villas: PublicVilla[], min: number = MIN_FACET_VILLAS): FacetPage[] {
  return [
    ...areaFacets(villas, min),
    ...featureFacets(villas, min),
    ...guestFacets(villas, min),
    ...bedroomFacets(villas, min),
    ...areaFeatureFacets(villas, min),
  ];
}

/** 패싯 파라미터로 빌라를 거른다 — 패싯 페이지 렌더가 사용(조회 조건 재작성 금지). */
export function filterByFacet(villas: PublicVilla[], params: FacetPage["params"]): PublicVilla[] {
  return villas.filter((v) => {
    if (params.area && v.areaCode !== params.area) return false;
    if (params.feature && !v.featureKeys.includes(params.feature)) return false;
    if (params.guests && v.maxGuests < params.guests) return false;
    if (params.bedrooms && v.bedrooms < params.bedrooms) return false;
    return true;
  });
}
