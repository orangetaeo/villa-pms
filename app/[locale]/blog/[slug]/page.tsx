// app/[locale]/blog/[slug]/page.tsx — 비-ko 가이드 글 상세 (en·vi·ru·zh, ADR-0049)
//
// ★ 번역 없는 글은 404(ArticlePage 내부 getPublishedArticleLocalized=null → notFound).
// ★ "ko"는 프리픽스 없는 /blog/[slug]로 301. 잡값 로케일은 404.
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { articleMetadata, ArticlePage } from "@/components/seo/pages/article-page";
import { parseBlogLocaleParam } from "@/lib/seo/blog-locale";
import { blogPaths } from "@/lib/seo/routes";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  const l = parseBlogLocaleParam(locale);
  if (!l) return { title: "404 | Villa GO", robots: { index: false } };
  return articleMetadata(slug, l);
}

export default async function LocaleArticleDetail({ params }: Params) {
  const { locale, slug } = await params;
  if (locale === "ko") permanentRedirect(blogPaths.article(slug));
  const l = parseBlogLocaleParam(locale);
  if (!l) notFound();
  return <ArticlePage slug={slug} locale={l} />;
}
