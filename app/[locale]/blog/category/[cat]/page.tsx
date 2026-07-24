// app/[locale]/blog/category/[cat]/page.tsx — 비-ko 대분류별 글 목록 (en·vi·ru·zh, ADR-0049)
//
// ★ 비-ko는 READY 번역 보유 글만 나열(CategoryListPage 내부). "ko"는 프리픽스 없는 URL로 301. 잡값 404.
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { categoryMetadata, CategoryListPage } from "@/components/seo/pages/category-page";
import { parseBlogLocaleParam } from "@/lib/seo/blog-locale";
import { blogPaths } from "@/lib/seo/routes";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = {
  params: Promise<{ locale: string; cat: string }>;
  searchParams: Promise<{ page?: string }>;
};

function parsePage(raw: string | undefined): number {
  const n = parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, cat } = await params;
  const l = parseBlogLocaleParam(locale);
  if (!l) return { title: "404 | Villa GO", robots: { index: false } };
  return categoryMetadata(cat, l);
}

export default async function LocaleCategoryList({ params, searchParams }: Params) {
  const { locale, cat } = await params;
  if (locale === "ko") permanentRedirect(blogPaths.categoryList(cat));
  const l = parseBlogLocaleParam(locale);
  if (!l) notFound();
  const page = parsePage((await searchParams).page);
  return <CategoryListPage cat={cat} locale={l} page={page} />;
}
