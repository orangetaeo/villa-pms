// components/seo/pages/blog-hub.tsx — 공개 콘텐츠 허브 본체 (ko/en/vi/ru/zh 공용, ADR-0049)
//
// ★ app/blog/page.tsx(ko)와 app/[locale]/blog/page.tsx(비-ko)가 이 컴포넌트를 locale만 바꿔 호출한다.
// ★ 발행 글 0건이어도 200. sitemap 등재는 글 1건 이상일 때만(app/sitemap.ts).
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { BlogHeader } from "@/components/seo/pages/blog-header";
import { getPublishedArticlesLocalized, allLocaleAlternates, OG_LOCALE } from "@/lib/seo/article-i18n";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { SEO_ARTICLE_CATEGORIES } from "@/lib/seo/categories";
import { PUBLIC_LOCALES, type PublicLocale } from "@/lib/seo/public-i18n";
import { blogStrings, formatPublicDate } from "@/lib/seo/blog-i18n";

/** 언어 스위처용 — 각 로케일의 허브 URL. */
function hubLangLinks(): Partial<Record<PublicLocale, string>> {
  return Object.fromEntries(PUBLIC_LOCALES.map((l) => [l.code, blogPaths.hub(l.code)]));
}

export function blogHubMetadata(locale: PublicLocale): Metadata {
  const t = blogStrings(locale);
  const url = absoluteUrl(blogPaths.hub(locale));
  return {
    title: `${t.hubTitle} | Villa GO`,
    description: t.hubDesc,
    alternates: { canonical: url, ...allLocaleAlternates((l) => blogPaths.hub(l)) },
    openGraph: {
      type: "website",
      siteName: "Villa GO",
      title: t.hubTitle,
      description: t.hubDesc,
      url,
      locale: OG_LOCALE[locale],
    },
  };
}

export async function BlogHubPage({ locale }: { locale: PublicLocale }) {
  const t = blogStrings(locale);
  let articles: Awaited<ReturnType<typeof getPublishedArticlesLocalized>> = [];
  try {
    articles = await getPublishedArticlesLocalized(locale);
  } catch {
    articles = [];
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <BlogHeader locale={locale} links={hubLangLinks()} consultLabel={t.consult} />

      <section className="px-5 py-8">
        <h1 className="text-2xl font-extrabold">{t.hubTitle}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{t.hubSubtitle}</p>

        <nav aria-label={t.hubTitle} className="mt-4 flex flex-wrap gap-2">
          {SEO_ARTICLE_CATEGORIES.map((cat) => (
            <Link
              key={cat}
              href={blogPaths.categoryList(cat, locale)}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-teal-600 hover:text-teal-700"
            >
              {t.categoryLabels[cat]}
            </Link>
          ))}
        </nav>
      </section>

      {articles.length === 0 ? (
        <section className="px-5 pb-12">
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-600">
            {t.hubEmpty}{" "}
            <Link href="/chat?src=seo" className="font-semibold text-teal-700">
              {t.hubEmptyCta}
            </Link>
            .
          </p>
        </section>
      ) : (
        <section className="px-5 pb-12">
          <ul className="space-y-6">
            {articles.map((a) => (
              <li key={a.id}>
                <Link href={blogPaths.article(a.slug, locale)} className="group block">
                  <article className="overflow-hidden rounded-2xl border border-slate-200 transition group-hover:border-teal-300 group-hover:shadow-sm">
                    {a.coverPhotoUrl && (
                      <div className="relative aspect-[16/9] bg-slate-100">
                        <Image
                          src={a.coverPhotoUrl}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 100vw, 640px"
                          className="object-cover"
                        />
                      </div>
                    )}
                    <div className="p-4">
                      <h2 className="text-lg font-bold group-hover:text-teal-700">{a.title}</h2>
                      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">{a.summary}</p>
                      <p className="mt-2 text-xs text-slate-400 tabular-nums">{formatPublicDate(a.publishedAt, locale)}</p>
                    </div>
                  </article>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p className="font-semibold text-slate-700">Villa GO</p>
        <p className="mt-2">
          {t.footerContact}{" "}
          <a href="mailto:biz.villago@gmail.com" className="text-teal-700">
            biz.villago@gmail.com
          </a>
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
