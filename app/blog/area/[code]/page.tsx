// /blog/area/[code] — 지역(단지)별 빌라 (ko 캐논, T-seo-s2 · ADR-0050)
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FacetPageView, { loadFacet } from "@/lib/seo/facet-page";
import { MIN_FACET_VILLAS } from "@/lib/seo/facets";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { allLocaleAlternates } from "@/lib/seo/article-i18n";
import { villaStrings } from "@/lib/seo/villa-i18n";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const t = villaStrings("ko");
  const d = await loadFacet(blogPaths.area(code));
  if (!d) return { title: t.areaNotFound, robots: { index: false } };
  const name = d.areaNames[code] ?? code;
  return {
    title: t.areaMetaTitle(name, d.villas.length),
    description: t.areaMetaDesc(name),
    alternates: { canonical: absoluteUrl(blogPaths.area(code)), ...allLocaleAlternates((l) => blogPaths.area(code, l)) },
    robots: { index: d.facet.count >= MIN_FACET_VILLAS, follow: true },
  };
}

export default async function AreaFacetPage({ params }: Params) {
  const { code } = await params;
  const t = villaStrings("ko");
  const d = await loadFacet(blogPaths.area(code));
  if (!d) notFound();
  const name = d.areaNames[code] ?? code;
  return <FacetPageView data={d} title={t.areaTitle(name)} intro={t.areaIntro(name)} locale="ko" />;
}
