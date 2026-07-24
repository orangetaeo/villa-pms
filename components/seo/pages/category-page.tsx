// components/seo/pages/category-page.tsx — 대분류별 글 목록 본체 (ko/en/vi/ru/zh 공용, ADR-0049)
//
// ★ app/blog/category/[cat]/page.tsx(ko)·app/[locale]/blog/category/[cat]/page.tsx(비-ko)가 공용 호출.
// ★ 비-ko는 READY 번역 보유 글만 나열·집계한다(getPublishedArticlesByCategoryLocalized).
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BlogHeader } from "@/components/seo/pages/blog-header";
import ArticleCardList from "@/components/seo/article-card-list";
import {
  getPublishedArticlesByCategoryLocalized,
  allLocaleAlternates,
  OG_LOCALE,
} from "@/lib/seo/article-i18n";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { isSeoArticleCategory } from "@/lib/seo/categories";
import { PUBLIC_LOCALES, type PublicLocale } from "@/lib/seo/public-i18n";
import { blogStrings } from "@/lib/seo/blog-i18n";

function langLinks(cat: string): Partial<Record<PublicLocale, string>> {
  return Object.fromEntries(PUBLIC_LOCALES.map((l) => [l.code, blogPaths.categoryList(cat, l.code)]));
}

export function categoryMetadata(cat: string, locale: PublicLocale): Metadata {
  const t = blogStrings(locale);
  if (!isSeoArticleCategory(cat)) return { title: "404 | Villa GO", robots: { index: false } };
  const label = t.categoryLabels[cat];
  const url = absoluteUrl(blogPaths.categoryList(cat, locale)); // canonical = 페이지 파라미터 제거 기준
  return {
    title: `${label} | ${t.hubTitle} | Villa GO`,
    description: t.categoryIntro(label),
    alternates: { canonical: url, ...allLocaleAlternates((l) => blogPaths.categoryList(cat, l)) },
    openGraph: {
      type: "website",
      siteName: "Villa GO",
      title: `${t.phuQuoc} ${label}`,
      description: t.categoryIntro(label),
      url,
      locale: OG_LOCALE[locale],
    },
  };
}

export async function CategoryListPage({
  cat,
  locale,
  page,
}: {
  cat: string;
  locale: PublicLocale;
  page: number;
}) {
  if (!isSeoArticleCategory(cat)) notFound();
  const t = blogStrings(locale);
  const label = t.categoryLabels[cat];

  let data: Awaited<ReturnType<typeof getPublishedArticlesByCategoryLocalized>>;
  try {
    data = await getPublishedArticlesByCategoryLocalized(cat, locale, page);
  } catch {
    data = { articles: [], total: 0, page, pageSize: 10, totalPages: 1 };
  }
  const { articles, page: current, totalPages } = data;
  const base = blogPaths.categoryList(cat, locale);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <BlogHeader locale={locale} links={langLinks(cat)} consultLabel={t.consult} />

      <section className="px-5 py-6">
        <nav className="text-xs text-slate-400">
          <Link href={blogPaths.hub(locale)} className="hover:underline">
            {t.hubTitle}
          </Link>
        </nav>
        <h1 className="mt-2 text-2xl font-extrabold leading-snug">{label}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{t.categoryIntro(label)}</p>
      </section>

      {articles.length === 0 ? (
        <section className="px-5 pb-12">
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-600">
            {t.categoryEmpty}{" "}
            <Link href={blogPaths.hub(locale)} className="font-semibold text-teal-700">
              {t.allGuides}
            </Link>
          </p>
        </section>
      ) : (
        <section className="px-5 pb-8">
          <ArticleCardList articles={articles} locale={locale} />

          {totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-between text-sm font-semibold">
              {current > 1 ? (
                <Link
                  href={`${base}${current - 1 > 1 ? `?page=${current - 1}` : ""}`}
                  className="rounded-full border border-slate-200 px-4 py-2 text-teal-700"
                  rel="prev"
                >
                  {t.prev}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-slate-400 tabular-nums">
                {current} / {totalPages}
              </span>
              {current < totalPages ? (
                <Link
                  href={`${base}?page=${current + 1}`}
                  className="rounded-full border border-slate-200 px-4 py-2 text-teal-700"
                  rel="next"
                >
                  {t.next}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
      )}

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
