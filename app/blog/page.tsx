// app/blog/page.tsx — 공개 콘텐츠 허브 (T-seo-s3)
//
// ★ 발행 글이 0건이어도 200으로 응답한다. 다만 sitemap에는 **글이 1건 이상일 때만** 등재한다
//   (app/sitemap.ts) — 빈 허브를 검색엔진에 밀어넣으면 얇은 콘텐츠 신호가 된다.
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { getPublishedArticles } from "@/lib/seo/article";
import { blogPaths, BLOG_ROOT } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "푸꾸옥 여행 가이드 | Villa GO",
    description: "푸꾸옥 빌라 여행에 필요한 정보 — 이동, 시즌, 아이 동반, 골프, 빌라 고르는 법.",
    alternates: { canonical: absoluteUrl(BLOG_ROOT) },
    openGraph: {
      type: "website",
      siteName: "Villa GO",
      title: "푸꾸옥 여행 가이드",
      description: "푸꾸옥 빌라 여행에 필요한 정보를 정리했습니다.",
      url: absoluteUrl(BLOG_ROOT),
      locale: "ko_KR",
    },
  };
}

function formatKoDate(d: Date): string {
  // DESIGN.md: 날짜는 YYYY.MM.DD 점 표기
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())}`;
}

export default async function BlogHub() {
  let articles: Awaited<ReturnType<typeof getPublishedArticles>> = [];
  try {
    articles = await getPublishedArticles();
  } catch {
    // DB 장애가 허브를 500으로 만들지 않는다 — 빈 목록으로 살린다.
    articles = [];
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
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

      <section className="px-5 py-8">
        <h1 className="text-2xl font-extrabold">푸꾸옥 여행 가이드</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          빌라 여행에 필요한 정보를 현지에서 직접 정리합니다.
        </p>
      </section>

      {articles.length === 0 ? (
        <section className="px-5 pb-12">
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-600">
            첫 가이드를 준비하고 있습니다. 지금 필요한 정보가 있으시면{" "}
            <Link href="/chat?src=seo" className="font-semibold text-teal-700">
              상담으로 바로 물어보세요
            </Link>
            .
          </p>
        </section>
      ) : (
        <section className="px-5 pb-12">
          <ul className="space-y-6">
            {articles.map((a) => (
              <li key={a.id}>
                <article className="overflow-hidden rounded-2xl border border-slate-200">
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
                    <h2 className="text-lg font-bold">
                      <Link href={blogPaths.article(a.slug)}>{a.title}</Link>
                    </h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">{a.summary}</p>
                    <p className="mt-2 text-xs text-slate-400 tabular-nums">{formatKoDate(a.publishedAt)}</p>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p className="font-semibold text-slate-700">Villa GO</p>
        <p className="mt-2">
          문의{" "}
          <a href="mailto:biz.villago@gmail.com" className="text-teal-700">
            biz.villago@gmail.com
          </a>
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
