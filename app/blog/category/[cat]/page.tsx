// app/blog/category/[cat]/page.tsx — 대분류별 글 목록 (ko 캐논, ADR-0049)
//
// ★ 렌더·메타 본체는 components/seo/pages/category-page.tsx로 이관됐다(비-ko 라우트와 공용).
//   이 파일은 locale="ko" thin wrapper — 기존 /blog/category/[cat] URL·출력은 변화 0.
import type { Metadata } from "next";
import { categoryMetadata, CategoryListPage } from "@/components/seo/pages/category-page";
import { SEO_ARTICLE_CATEGORIES } from "@/lib/seo/categories";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = {
  params: Promise<{ cat: string }>;
  searchParams: Promise<{ page?: string }>;
};

// 4개 카테고리는 미리 알려진 유한 집합 — 정적 파라미터로 노출한다.
export function generateStaticParams() {
  return SEO_ARTICLE_CATEGORIES.map((cat) => ({ cat }));
}

function parsePage(raw: string | undefined): number {
  const n = parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { cat } = await params;
  return categoryMetadata(cat, "ko");
}

export default async function CategoryList({ params, searchParams }: Params) {
  const { cat } = await params;
  const page = parsePage((await searchParams).page);
  return <CategoryListPage cat={cat} locale="ko" page={page} />;
}
