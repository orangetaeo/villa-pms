// components/seo/facet-nav.tsx — 조건 탐색 내비게이션 (T-seo-s2)
//
// ★ 이것이 "소비자 검색"의 SEO 구현체다. 필터를 쿼리스트링으로만 두면 크롤러가 색인하지 않으므로,
//   살아있는 패싯만 **URL을 가진 링크**로 노출한다(3개 미만 조건은 애초에 만들어지지 않는다).
// ★ 날짜(공실) 조건은 여기에 절대 넣지 않는다 — 원칙 1(재고 비공개).
import Link from "next/link";
import type { FacetPage } from "@/lib/seo/facets";

const KIND_LABEL: Record<string, string> = {
  area: "지역으로 찾기",
  feature: "시설·특징으로 찾기",
  guests: "인원으로 찾기",
  bedrooms: "침실 수로 찾기",
  areaFeature: "지역 × 시설",
};

const FEATURE_KO: Record<string, string> = {
  viewSea: "바다뷰",
  viewMountain: "마운틴뷰",
  viewCity: "시티뷰",
  bbq: "BBQ",
  elevator: "엘리베이터",
  generator: "발전기",
  kidsPool: "키즈풀",
  privatePool: "프라이빗 풀",
  gym: "헬스장",
  golfNearby: "골프장 인근",
  beachFront: "해변 바로앞",
  marketNearby: "시장 인근",
};

/** 패싯 → 사람이 읽는 라벨 */
export function facetLabel(f: FacetPage, areaNames: Record<string, string> = {}): string {
  if (f.params.guests) return `${f.params.guests}인 이상`;
  if (f.params.bedrooms) return `침실 ${f.params.bedrooms}개 이상`;
  if (f.params.area && f.params.feature)
    return `${areaNames[f.params.area] ?? f.params.area} · ${FEATURE_KO[f.params.feature] ?? f.params.feature}`;
  if (f.params.area) return areaNames[f.params.area] ?? f.params.area;
  if (f.params.feature) return FEATURE_KO[f.params.feature] ?? f.params.feature;
  return "전체";
}

export default function FacetNav({
  facets,
  areaNames = {},
  currentPath,
}: {
  facets: FacetPage[];
  areaNames?: Record<string, string>;
  currentPath?: string;
}) {
  if (facets.length === 0) return null;
  const groups = ["area", "feature", "guests", "bedrooms"] as const;

  return (
    <nav className="space-y-5">
      {groups.map((kind) => {
        const items = facets.filter((f) => f.kind === kind);
        if (items.length === 0) return null;
        return (
          <div key={kind}>
            <h2 className="text-sm font-bold text-slate-500">{KIND_LABEL[kind]}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {items.map((f) => {
                const active = currentPath === f.path;
                return (
                  <Link
                    key={f.path}
                    href={f.path}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                      active ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-700"
                    }`}
                  >
                    {facetLabel(f, areaNames)}
                    <span className={`ml-1 text-xs ${active ? "text-teal-100" : "text-slate-400"}`}>{f.count}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
