// components/seo/pages/villas-page.tsx — 공개 빌라 전체 목록 본체 (ko/en/vi/ru/zh 공용, ADR-0050)
//
// ★ app/blog/villas/page.tsx(ko)·app/[locale]/blog/villas/page.tsx(비-ko)가 공용 호출.
// ★ 소비자 검색형: 목록·조건 탐색을 연다. 날짜(공실) 필터는 없다 — 원칙 1(재고 비공개).
// ★ 비-ko도 항상 200 — 라벨·칩·패싯은 사전/숫자로 즉시 로케일화, 티저(소개문)만 READY 번역이 있을 때 노출.
import Link from "next/link";
import type { Metadata } from "next";
import { BlogHeader } from "@/components/seo/pages/blog-header";
import { getPublicVillas } from "@/lib/seo/public-villa";
import { allFacetPages } from "@/lib/seo/facets";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import VillaList from "@/components/seo/villa-list";
import FacetNav from "@/components/seo/facet-nav";
import { allLocaleAlternates, OG_LOCALE } from "@/lib/seo/article-i18n";
import { PUBLIC_LOCALES, type PublicLocale } from "@/lib/seo/public-i18n";
import { blogStrings } from "@/lib/seo/blog-i18n";
import { villaStrings } from "@/lib/seo/villa-i18n";

export function villasMetadata(locale: PublicLocale): Metadata {
  const t = villaStrings(locale);
  const url = absoluteUrl(blogPaths.villas(locale));
  return {
    title: t.villasMetaTitle,
    description: t.villasMetaDesc,
    alternates: { canonical: url, ...allLocaleAlternates((l) => blogPaths.villas(l)) },
    openGraph: {
      type: "website",
      siteName: "Villa GO",
      title: t.villasH1,
      description: t.villasMetaDesc,
      url,
      locale: OG_LOCALE[locale],
    },
  };
}

export async function VillasIndexPage({ locale }: { locale: PublicLocale }) {
  const t = villaStrings(locale);
  const chrome = blogStrings(locale);

  let villas: Awaited<ReturnType<typeof getPublicVillas>> = [];
  try {
    villas = await getPublicVillas();
  } catch {
    villas = [];
  }
  const facets = allFacetPages(villas);
  const areaNames: Record<string, string> = {};
  for (const v of villas) {
    if (v.areaCode) areaNames[v.areaCode] = v.areaNameKo ?? v.areaName ?? v.areaCode;
  }

  const langLinks: Partial<Record<PublicLocale, string>> = Object.fromEntries(
    PUBLIC_LOCALES.map((l) => [l.code, blogPaths.villas(l.code)]),
  );

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <BlogHeader locale={locale} links={langLinks} consultLabel={chrome.consult} />

      <section className="px-5 py-6">
        <h1 className="text-2xl font-extrabold leading-snug">{t.villasH1}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{t.villasIntro}</p>
        <p className="mt-2 text-sm font-semibold text-teal-700">{t.villaCount(villas.length)}</p>
      </section>

      {facets.length > 0 && (
        <section className="px-5 pb-6">
          <FacetNav facets={facets} areaNames={areaNames} locale={locale} />
        </section>
      )}

      <section className="px-5 pb-10">
        <VillaList villas={villas} locale={locale} />
      </section>

      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p>
          <Link href={blogPaths.hub(locale)} className="font-semibold text-teal-700">
            {chrome.backToGuide}
          </Link>
        </p>
        <p className="mt-3">
          <Link href="/privacy" className="underline">
            {chrome.privacy}
          </Link>
        </p>
      </footer>
    </div>
  );
}
