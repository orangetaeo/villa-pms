// app/[locale]/blog/area/[code] — 비-ko 지역(단지)별 빌라 (en·vi·ru·zh, ADR-0050)
// ★ 패싯 정체성(경로)은 ko 불변 — loadFacet은 ko 경로로 매칭하고 렌더만 로케일화. "ko"는 301, 잡값 404.
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import FacetPageView, { loadFacet } from "@/lib/seo/facet-page";
import { MIN_FACET_VILLAS } from "@/lib/seo/facets";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { allLocaleAlternates } from "@/lib/seo/article-i18n";
import { parseBlogLocaleParam } from "@/lib/seo/blog-locale";
import { villaStrings } from "@/lib/seo/villa-i18n";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ locale: string; code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, code } = await params;
  const l = parseBlogLocaleParam(locale);
  if (!l) return { title: "404 | Villa GO", robots: { index: false } };
  const t = villaStrings(l);
  const d = await loadFacet(blogPaths.area(code));
  if (!d) return { title: t.areaNotFound, robots: { index: false } };
  const name = d.areaNames[code] ?? code;
  return {
    title: t.areaMetaTitle(name, d.villas.length),
    description: t.areaMetaDesc(name),
    alternates: {
      canonical: absoluteUrl(blogPaths.area(code, l)),
      ...allLocaleAlternates((x) => blogPaths.area(code, x)),
    },
    robots: { index: d.facet.count >= MIN_FACET_VILLAS, follow: true },
  };
}

export default async function LocaleAreaFacetPage({ params }: Params) {
  const { locale, code } = await params;
  if (locale === "ko") permanentRedirect(blogPaths.area(code));
  const l = parseBlogLocaleParam(locale);
  if (!l) notFound();
  const t = villaStrings(l);
  const d = await loadFacet(blogPaths.area(code));
  if (!d) notFound();
  const name = d.areaNames[code] ?? code;
  return <FacetPageView data={d} title={t.areaTitle(name)} intro={t.areaIntro(name)} locale={l} />;
}
