// components/seo/facet-nav.tsx — 조건 탐색 내비게이션 (T-seo-s2 · ADR-0050 로케일화)
//
// ★ 이것이 "소비자 검색"의 SEO 구현체다. 필터를 쿼리스트링으로만 두면 크롤러가 색인하지 않으므로,
//   살아있는 패싯만 **URL을 가진 링크**로 노출한다(3개 미만 조건은 애초에 만들어지지 않는다).
// ★ 날짜(공실) 조건은 여기에 절대 넣지 않는다 — 원칙 1(재고 비공개).
// ★ 로케일(기본 ko): 라벨=villa-i18n(facetKindLabels·featureLabels), 링크는 blogLocalePrefix로 접두한다.
//   FacetPage.path 자체는 ko 경로로 불변(패싯 정체성) — active 비교도 원본 f.path로 한다(ADR §4).
import Link from "next/link";
import type { FacetPage } from "@/lib/seo/facets";
import { type PublicLocale } from "@/lib/seo/public-i18n";
import { blogLocalePrefix } from "@/lib/seo/blog-locale";
import { villaStrings, featureLabels } from "@/lib/seo/villa-i18n";

/** 패싯 → 사람이 읽는 라벨(로케일별). */
export function facetLabel(
  f: FacetPage,
  areaNames: Record<string, string> = {},
  locale: PublicLocale = "ko",
): string {
  const t = villaStrings(locale);
  const feat = featureLabels(locale);
  if (f.params.guests) return t.guestsAtLeast(f.params.guests);
  if (f.params.bedrooms) return t.bedroomsAtLeast(f.params.bedrooms);
  if (f.params.area && f.params.feature)
    return `${areaNames[f.params.area] ?? f.params.area} · ${feat[f.params.feature] ?? f.params.feature}`;
  if (f.params.area) return areaNames[f.params.area] ?? f.params.area;
  if (f.params.feature) return feat[f.params.feature] ?? f.params.feature;
  return t.facetKindLabels.area ?? "";
}

export default function FacetNav({
  facets,
  areaNames = {},
  currentPath,
  locale = "ko",
}: {
  facets: FacetPage[];
  areaNames?: Record<string, string>;
  currentPath?: string;
  locale?: PublicLocale;
}) {
  if (facets.length === 0) return null;
  const t = villaStrings(locale);
  const prefix = blogLocalePrefix(locale);
  const groups = ["area", "feature", "guests", "bedrooms"] as const;

  return (
    <nav className="space-y-5">
      {groups.map((kind) => {
        const items = facets.filter((f) => f.kind === kind);
        if (items.length === 0) return null;
        return (
          <div key={kind}>
            <h2 className="text-sm font-bold text-slate-500">{t.facetKindLabels[kind]}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {items.map((f) => {
                const active = currentPath === f.path;
                return (
                  <Link
                    key={f.path}
                    href={`${prefix}${f.path}`}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                      active ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-700"
                    }`}
                  >
                    {facetLabel(f, areaNames, locale)}
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
