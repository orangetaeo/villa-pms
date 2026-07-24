// app/[locale]/blog/feature/[key] — 비-ko 시설·특징별 빌라 (en·vi·ru·zh, ADR-0050)
// ★ FEATURE 라벨은 villa-i18n.ts featureLabels 단일 소스. "ko"는 301, 잡값 404.
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import FacetPageView, { loadFacet } from "@/lib/seo/facet-page";
import { MIN_FACET_VILLAS } from "@/lib/seo/facets";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { allLocaleAlternates } from "@/lib/seo/article-i18n";
import { parseBlogLocaleParam } from "@/lib/seo/blog-locale";
import { villaStrings, featureLabels } from "@/lib/seo/villa-i18n";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ locale: string; key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, key } = await params;
  const l = parseBlogLocaleParam(locale);
  if (!l) return { title: "404 | Villa GO", robots: { index: false } };
  const t = villaStrings(l);
  const d = await loadFacet(blogPaths.feature(key));
  if (!d) return { title: t.facetNotFound, robots: { index: false } };
  const label = featureLabels(l)[key] ?? key;
  return {
    title: t.featureMetaTitle(label, d.villas.length),
    description: t.featureMetaDesc(label),
    alternates: {
      canonical: absoluteUrl(blogPaths.feature(key, l)),
      ...allLocaleAlternates((x) => blogPaths.feature(key, x)),
    },
    robots: { index: d.facet.count >= MIN_FACET_VILLAS, follow: true },
  };
}

export default async function LocaleFeatureFacetPage({ params }: Params) {
  const { locale, key } = await params;
  if (locale === "ko") permanentRedirect(blogPaths.feature(key));
  const l = parseBlogLocaleParam(locale);
  if (!l) notFound();
  const t = villaStrings(l);
  const d = await loadFacet(blogPaths.feature(key));
  if (!d) notFound();
  const label = featureLabels(l)[key] ?? key;
  return <FacetPageView data={d} title={t.featureTitle(label)} intro={t.featureIntro(label)} locale={l} />;
}
