// app/blog/category/[cat]/page.tsx — 대분류별 글 목록 (T-seo-category)
//
// ★ 경로 네임스페이스가 `/blog/category/[cat]`인 이유: `/blog/[slug]`가 catch-all이라
//   `/blog/guide` 같은 정적 세그먼트는 장차 글 slug와 겹칠 때 그 글을 가로챈다.
//   `category/` 한 단을 끼우면 [slug]와 절대 충돌하지 않는다(routes.ts 규약).
// ★ 글 slug·상세 URL은 불변 — 이 페이지는 탐색용 목록만 추가한다.
import Link from "next/link";
import { VillaGoHeaderLogo } from "@/components/brand/villa-go-header-logo";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedArticlesByCategory } from "@/lib/seo/article";
import ArticleCardList from "@/components/seo/article-card-list";
import { blogPaths, BLOG_ROOT } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import {
  SEO_ARTICLE_CATEGORIES,
  isSeoArticleCategory,
  seoArticleCategoryLabel,
} from "@/lib/seo/categories";

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
  if (!isSeoArticleCategory(cat)) return { title: "찾을 수 없는 분류 | Villa GO", robots: { index: false } };
  const label = seoArticleCategoryLabel(cat, "ko");
  // ★ canonical은 페이지 파라미터를 제거한 카테고리 기준 URL로 고정한다(중복 색인 방지).
  const url = absoluteUrl(blogPaths.categoryList(cat));
  return {
    title: `${label} | 푸꾸옥 여행 가이드 | Villa GO`,
    description: `푸꾸옥 ${label} 관련 글 모음 — 현지에서 직접 정리한 정보입니다.`,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "Villa GO",
      title: `푸꾸옥 ${label}`,
      description: `푸꾸옥 ${label} 관련 글 모음입니다.`,
      url,
      locale: "ko_KR",
    },
  };
}

export default async function CategoryListPage({ params, searchParams }: Params) {
  const { cat } = await params;
  if (!isSeoArticleCategory(cat)) notFound();
  const page = parsePage((await searchParams).page);
  const label = seoArticleCategoryLabel(cat, "ko");

  let data: Awaited<ReturnType<typeof getPublishedArticlesByCategory>>;
  try {
    data = await getPublishedArticlesByCategory(cat, page);
  } catch {
    // DB 장애가 목록을 500으로 만들지 않는다 — 빈 목록으로 살린다.
    data = { articles: [], total: 0, page, pageSize: 10, totalPages: 1 };
  }
  const { articles, page: current, totalPages } = data;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <VillaGoHeaderLogo />
        <Link
          href="/chat?src=seo"
          className="rounded-full border border-teal-600 px-3 py-1.5 text-sm font-semibold text-teal-700"
        >
          상담하기
        </Link>
      </header>

      <section className="px-5 py-6">
        <nav className="text-xs text-slate-400">
          <Link href={BLOG_ROOT} className="hover:underline">
            푸꾸옥 여행 가이드
          </Link>
        </nav>
        <h1 className="mt-2 text-2xl font-extrabold leading-snug">{label}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          푸꾸옥 {label} 관련 글을 모았습니다.
        </p>
      </section>

      {articles.length === 0 ? (
        <section className="px-5 pb-12">
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-600">
            아직 이 분류의 글이 없습니다.{" "}
            <Link href={BLOG_ROOT} className="font-semibold text-teal-700">
              전체 가이드 보기
            </Link>
          </p>
        </section>
      ) : (
        <section className="px-5 pb-8">
          <ArticleCardList articles={articles} />

          {totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-between text-sm font-semibold">
              {current > 1 ? (
                <Link
                  href={`${blogPaths.categoryList(cat)}${current - 1 > 1 ? `?page=${current - 1}` : ""}`}
                  className="rounded-full border border-slate-200 px-4 py-2 text-teal-700"
                  rel="prev"
                >
                  ← 이전
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-slate-400 tabular-nums">
                {current} / {totalPages}
              </span>
              {current < totalPages ? (
                <Link
                  href={`${blogPaths.categoryList(cat)}?page=${current + 1}`}
                  className="rounded-full border border-slate-200 px-4 py-2 text-teal-700"
                  rel="next"
                >
                  다음 →
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
          <Link href={BLOG_ROOT} className="font-semibold text-teal-700">
            ← 푸꾸옥 여행 가이드
          </Link>
        </p>
        <p className="mt-3">
          <Link href="/privacy" className="underline">
            개인정보처리방침
          </Link>
        </p>
      </footer>
    </div>
  );
}
