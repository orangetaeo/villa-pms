// /blog/feature/[key] — 시설·특징별 빌라 (ko 캐논, T-seo-s2 · ADR-0050)
// ★ FEATURE 라벨은 lib/seo/villa-i18n.ts featureLabels 단일 소스(ADR §5) — 사본을 두지 않는다.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FacetPageView, { loadFacet } from "@/lib/seo/facet-page";
import { MIN_FACET_VILLAS } from "@/lib/seo/facets";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { allLocaleAlternates } from "@/lib/seo/article-i18n";
import { villaStrings, featureLabels } from "@/lib/seo/villa-i18n";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  const t = villaStrings("ko");
  const d = await loadFacet(blogPaths.feature(key));
  if (!d) return { title: t.facetNotFound, robots: { index: false } };
  const label = featureLabels("ko")[key] ?? key;
  return {
    title: t.featureMetaTitle(label, d.villas.length),
    description: t.featureMetaDesc(label),
    alternates: {
      canonical: absoluteUrl(blogPaths.feature(key)),
      ...allLocaleAlternates((l) => blogPaths.feature(key, l)),
    },
    // 빌라 3곳 미만은 얇은 콘텐츠 → 색인만 막는다(온사이트 필터는 작동). 사이트맵에도 이미 빠져 있다.
    robots: { index: d.facet.count >= MIN_FACET_VILLAS, follow: true },
  };
}

export default async function FeatureFacetPage({ params }: Params) {
  const { key } = await params;
  const t = villaStrings("ko");
  const d = await loadFacet(blogPaths.feature(key));
  if (!d) notFound();
  const label = featureLabels("ko")[key] ?? key;
  return <FacetPageView data={d} title={t.featureTitle(label)} intro={t.featureIntro(label)} locale="ko" />;
}
