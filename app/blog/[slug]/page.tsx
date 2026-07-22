// app/blog/[slug]/page.tsx — 가이드 글 상세 (T-seo-s3)
//
// ★ 미발행(DRAFT·PENDING_APPROVAL·APPROVED·REJECTED)은 404 — 승인 전 초안이 URL로 새면
//   검수 게이트가 무의미해진다. 조회 게이트는 lib/seo/article.ts가 단독으로 책임진다.
// ★ 정적 세그먼트(/blog/villa·/blog/area 등)는 Next가 우선 매칭하므로 이 catch-all이 가로채지 않는다.
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedArticleBySlug } from "@/lib/seo/article";
import ArticleBody from "@/components/seo/article-body";
import { blogPaths, BLOG_ROOT } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const a = await getPublishedArticleBySlug(slug).catch(() => null);
  if (!a) return { title: "찾을 수 없는 글 | Villa GO", robots: { index: false } };
  const url = absoluteUrl(blogPaths.article(a.slug));
  return {
    title: `${a.title} | Villa GO`,
    description: a.summary,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: "Villa GO",
      title: a.title,
      description: a.summary,
      url,
      locale: "ko_KR",
      publishedTime: a.publishedAt.toISOString(),
      ...(a.coverPhotoUrl ? { images: [{ url: a.coverPhotoUrl }] } : {}),
    },
  };
}

function formatKoDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())}`;
}

export default async function ArticlePage({ params }: Params) {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug).catch(() => null);
  if (!article) notFound();

  // JSON-LD Article — 구조화 데이터. ★가격·재고 필드는 넣지 않는다(공개 경계 승계).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.summary,
    inLanguage: "ko",
    datePublished: article.publishedAt.toISOString(),
    dateModified: article.updatedAt.toISOString(),
    mainEntityOfPage: absoluteUrl(blogPaths.article(article.slug)),
    publisher: { "@type": "Organization", name: "Villa GO" },
    ...(article.coverPhotoUrl ? { image: [article.coverPhotoUrl] } : {}),
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script
        type="application/ld+json"
        // JSON.stringify 결과만 주입 — 사용자 입력 HTML이 아니라 직렬화된 데이터다.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-lg font-extrabold tracking-tight text-teal-600">
          Villa GO
        </Link>
        <Link
          href="/chat?src=seo"
          className="rounded-full border border-teal-600 px-3 py-1.5 text-sm font-semibold text-teal-700"
        >
          상담하기
        </Link>
      </header>

      <article className="px-5 py-8">
        <nav className="text-xs text-slate-400">
          <Link href={BLOG_ROOT} className="hover:underline">
            푸꾸옥 여행 가이드
          </Link>
        </nav>
        <h1 className="mt-2 text-2xl font-extrabold leading-snug">{article.title}</h1>
        <p className="mt-2 text-xs text-slate-400 tabular-nums">{formatKoDate(article.publishedAt)}</p>

        {article.coverPhotoUrl && (
          <div className="relative mt-5 aspect-[16/9] overflow-hidden rounded-2xl bg-slate-100">
            <Image
              src={article.coverPhotoUrl}
              alt=""
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

        {/* 상담 CTA — ★가격은 어떤 형태로도 노출하지 않는다(원칙 2) */}
        <section className="mt-10 rounded-2xl bg-slate-50 p-5">
          <h2 className="text-lg font-bold">조건에 맞는 빌라가 궁금하세요?</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            인원과 일정, 원하는 시설을 알려주시면 현지에서 검수한 빌라를 골라 견적과 함께 보내드립니다.
          </p>
          <Link
            href="/chat?src=seo"
            className="mt-4 inline-flex touch-target items-center rounded-full bg-teal-600 px-6 text-base font-bold text-white"
          >
            1분 견적 상담
          </Link>
        </section>
      </article>

      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p>
          <Link href={BLOG_ROOT} className="font-semibold text-teal-700">
            ← 가이드 목록
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
