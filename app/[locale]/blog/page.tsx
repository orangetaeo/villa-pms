// app/[locale]/blog/page.tsx — 비-ko 블로그 허브 (en·vi·ru·zh, ADR-0049)
//
// ★ 유효 비-ko 로케일만 렌더. "ko"는 프리픽스 없는 /blog로 301(permanentRedirect). 잡값은 404.
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { blogHubMetadata, BlogHubPage } from "@/components/seo/pages/blog-hub";
import { parseBlogLocaleParam } from "@/lib/seo/blog-locale";
import { blogPaths } from "@/lib/seo/routes";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const l = parseBlogLocaleParam(locale);
  if (!l) return { title: "404 | Villa GO", robots: { index: false } };
  return blogHubMetadata(l);
}

export default async function LocaleBlogHub({ params }: Params) {
  const { locale } = await params;
  if (locale === "ko") permanentRedirect(blogPaths.hub());
  const l = parseBlogLocaleParam(locale);
  if (!l) notFound();
  return <BlogHubPage locale={l} />;
}
