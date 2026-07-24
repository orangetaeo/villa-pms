// app/[locale]/blog/guests/[n] — 비-ko 인원별 빌라 (en·vi·ru·zh, ADR-0050)
// ★ "ko"는 301, 잡값 로케일·범위 밖 n은 404.
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

type Params = { params: Promise<{ locale: string; n: string }> };

function parseN(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, n: raw } = await params;
  const l = parseBlogLocaleParam(locale);
  if (!l) return { title: "404 | Villa GO", robots: { index: false } };
  const t = villaStrings(l);
  const n = parseN(raw);
  const d = n ? await loadFacet(blogPaths.guests(n)) : null;
  if (!d || !n) return { title: t.facetNotFound, robots: { index: false } };
  return {
    title: t.guestsMetaTitle(n, d.villas.length),
    description: t.guestsMetaDesc(n),
    alternates: {
      canonical: absoluteUrl(blogPaths.guests(n, l)),
      ...allLocaleAlternates((x) => blogPaths.guests(n, x)),
    },
    robots: { index: d.facet.count >= MIN_FACET_VILLAS, follow: true },
  };
}

export default async function LocaleGuestsFacetPage({ params }: Params) {
  const { locale, n: raw } = await params;
  if (locale === "ko") {
    const n = parseN(raw);
    if (n) permanentRedirect(blogPaths.guests(n));
    notFound();
  }
  const l = parseBlogLocaleParam(locale);
  if (!l) notFound();
  const t = villaStrings(l);
  const n = parseN(raw);
  const d = n ? await loadFacet(blogPaths.guests(n)) : null;
  if (!d || !n) notFound();
  return <FacetPageView data={d} title={t.guestsTitle(n)} intro={t.guestsIntro(n)} locale={l} />;
}
