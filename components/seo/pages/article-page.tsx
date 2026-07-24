// components/seo/pages/article-page.tsx — 가이드 글 상세 본체 (ko/en/vi/ru/zh 공용, ADR-0049)
//
// ★ app/blog/[slug]/page.tsx(ko)·app/[locale]/blog/[slug]/page.tsx(비-ko)가 공용 호출.
// ★ 비-ko는 READY 번역이 없으면 404(getPublishedArticleLocalized=null) — ko 본문을 비-ko URL로 내보내지 않는다.
// ★ 지도·추천 빌라·CTA는 유지(내부 링크·전환 가치). 빌라 표시명(publicLabel)은 Phase 1에선 ko 유지(ADR §9).
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BlogHeader } from "@/components/seo/pages/blog-header";
import ArticleBody from "@/components/seo/article-body";
import VillaList from "@/components/seo/villa-list";
import { getPublicVillaApproxMapEmbed } from "@/lib/seo/public-villa";
import { getPlaceArticleMap } from "@/lib/seo/public-place";
import { guideMapEmbed } from "@/lib/seo/guide-map-anchors";
import { getRecommendedVillas } from "@/lib/seo/recommended-villas";
import {
  getPublishedArticleLocalized,
  getArticleAvailableLocales,
  articleAlternates,
  OG_LOCALE,
  BCP47,
} from "@/lib/seo/article-i18n";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { BRAND_FALLBACK_IMAGE } from "@/lib/seo/article-draft";
import { PUBLIC_LOCALES, type PublicLocale } from "@/lib/seo/public-i18n";
import { blogStrings, formatPublicDate } from "@/lib/seo/blog-i18n";

export async function articleMetadata(slug: string, locale: PublicLocale): Promise<Metadata> {
  const a = await getPublishedArticleLocalized(slug, locale).catch(() => null);
  if (!a) return { title: "404 | Villa GO", robots: { index: false } };
  const url = absoluteUrl(blogPaths.article(a.slug, locale));
  const available = await getArticleAvailableLocales(a.id).catch((): PublicLocale[] => ["ko", locale]);
  return {
    title: `${a.title} | Villa GO`,
    description: a.summary,
    alternates: { canonical: url, ...articleAlternates(a.slug, available) },
    openGraph: {
      type: "article",
      siteName: "Villa GO",
      title: a.title,
      description: a.summary,
      url,
      locale: OG_LOCALE[locale],
      publishedTime: a.publishedAt.toISOString(),
      // 커버 없으면 브랜드 이미지 폴백(빈 썸네일보다 낫다). 비-ko 텍스트 썸네일은 만들지 않는다(ADR §8).
      images: [{ url: absoluteUrl(a.coverPhotoUrl ?? BRAND_FALLBACK_IMAGE) }],
    },
  };
}

export async function ArticlePage({ slug, locale }: { slug: string; locale: PublicLocale }) {
  const t = blogStrings(locale);
  const article = await getPublishedArticleLocalized(slug, locale).catch(() => null);
  if (!article) notFound();

  const [villaMapEmbed, placeMap, availableLocales] = await Promise.all([
    article.category === "villa" && article.relatedVillaIds[0]
      ? getPublicVillaApproxMapEmbed(article.relatedVillaIds[0]).catch(() => null)
      : Promise.resolve(null),
    article.category === "place" ? getPlaceArticleMap(article.id).catch(() => null) : Promise.resolve(null),
    getArticleAvailableLocales(article.id).catch((): PublicLocale[] => ["ko", locale]),
  ]);
  const guideMap = article.category === "guide" ? guideMapEmbed(article.slug) : null;

  const recommendedVillas = await getRecommendedVillas({
    id: article.id,
    category: article.category,
    relatedVillaIds: article.relatedVillaIds,
  }).catch(() => []);
  const recommendTitle =
    article.category === "place" || article.category === "villa" ? t.recommendAreaTitle : t.recommendTitle;

  // 언어 스위처 링크: 번역 있는 언어→그 글, 없는 언어→해당 언어 허브(ADR §8 스위처 규칙).
  const langLinks: Partial<Record<PublicLocale, string>> = Object.fromEntries(
    PUBLIC_LOCALES.map((l) => [
      l.code,
      availableLocales.includes(l.code) ? blogPaths.article(article.slug, l.code) : blogPaths.hub(l.code),
    ]),
  );

  const placeLd = placeMap
    ? {
        "@context": "https://schema.org",
        "@type": placeMap.schemaType,
        name: placeMap.name,
        ...(placeMap.area
          ? { address: { "@type": "PostalAddress", addressLocality: placeMap.area, addressCountry: "VN" } }
          : {}),
        ...(placeMap.lat != null && placeMap.lng != null
          ? { geo: { "@type": "GeoCoordinates", latitude: placeMap.lat, longitude: placeMap.lng } }
          : {}),
        hasMap: placeMap.mapLink,
        mainEntityOfPage: absoluteUrl(blogPaths.article(article.slug, locale)),
      }
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    inLanguage: BCP47[locale], // 번역본의 언어를 명시(하이브리드 언어 신호 방지)
    datePublished: article.publishedAt.toISOString(),
    dateModified: article.updatedAt.toISOString(), // 캐논 수정 시각 유지(ADR §6)
    mainEntityOfPage: absoluteUrl(blogPaths.article(article.slug, locale)),
    publisher: { "@type": "Organization", name: "Villa GO" },
    image: [
      absoluteUrl(article.coverPhotoUrl ?? BRAND_FALLBACK_IMAGE),
      ...article.blocks
        .filter((b) => b.type === "img")
        .map((b) => (b as { url: string }).url)
        .map((u) => (u.startsWith("/") ? absoluteUrl(u) : u)),
    ].filter((u, i, arr) => arr.indexOf(u) === i),
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {placeLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(placeLd).replace(/</g, "\\u003c") }}
        />
      )}

      <BlogHeader locale={locale} links={langLinks} consultLabel={t.consult} />

      <article className="px-5 py-8">
        <nav className="text-xs text-slate-400">
          <Link href={blogPaths.hub(locale)} className="hover:underline">
            {t.hubTitle}
          </Link>
        </nav>
        <h1 className="mt-2 text-2xl font-extrabold leading-snug">{article.title}</h1>
        <p className="mt-2 text-xs text-slate-400 tabular-nums">{formatPublicDate(article.publishedAt, locale)}</p>

        {article.coverPhotoUrl && (
          <div className="relative mt-5 aspect-[16/9] overflow-hidden rounded-2xl bg-slate-100">
            <Image
              src={article.coverPhotoUrl}
              alt={article.title}
              fill
              sizes="(max-width: 640px) 100vw, 640px"
              className="object-cover"
            />
          </div>
        )}

        <p className="mt-5 leading-relaxed text-slate-600">{article.summary}</p>

        <div className="mt-6">
          <ArticleBody blocks={article.blocks} />
        </div>

        {villaMapEmbed && (
          <section className="mt-10">
            <h2 className="text-lg font-bold">{t.location}</h2>
            <p className="mt-1 text-sm text-slate-500">{t.villaApproxNote}</p>
            <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <iframe
                src={villaMapEmbed}
                title={t.location}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          </section>
        )}

        {placeMap && (
          <section className="mt-10">
            <h2 className="text-lg font-bold">{t.location}</h2>
            {placeMap.area && (
              <p className="mt-1 text-sm text-slate-500">
                {t.phuQuoc} {placeMap.area}
              </p>
            )}
            <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <iframe
                src={placeMap.embedUrl}
                title={`${placeMap.name} ${t.location}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
            <a
              href={placeMap.mapLink}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-2 inline-block text-sm font-semibold text-teal-700 hover:underline"
            >
              {t.placeOpenInMaps}
            </a>
          </section>
        )}

        {guideMap && (
          <section className="mt-10">
            <h2 className="text-lg font-bold">
              {guideMap.label} {t.location}
            </h2>
            <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <iframe
                src={guideMap.embedUrl}
                title={`${guideMap.label} ${t.location}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          </section>
        )}

        {recommendedVillas.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold">{recommendTitle}</h2>
            <div className="mt-3">
              <VillaList villas={recommendedVillas} />
            </div>
          </section>
        )}

        <section className="mt-10 rounded-2xl bg-slate-50 p-5">
          <h2 className="text-lg font-bold">{t.ctaTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{t.ctaBody}</p>
          <Link
            href="/chat?src=seo"
            className="mt-4 inline-flex touch-target items-center rounded-full bg-teal-600 px-6 text-base font-bold text-white"
          >
            {t.ctaButton}
          </Link>
        </section>
      </article>

      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p>
          <Link href={blogPaths.hub(locale)} className="font-semibold text-teal-700">
            {t.backToGuide}
          </Link>
        </p>
        <p className="mt-3">
          <Link href="/privacy" className="underline">
            {t.privacy}
          </Link>
        </p>
      </footer>
    </div>
  );
}
