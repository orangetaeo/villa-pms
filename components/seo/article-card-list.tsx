// components/seo/article-card-list.tsx — 블로그 글 카드 목록 (T-seo-category)
//
// 카테고리 목록 페이지가 쓰는 공용 카드 목록. 허브(app/blog/page.tsx)의 카드 마크업과
// 동일한 형태를 따르되, 썸네일은 thumbnailUrl ?? coverPhotoUrl 순으로 고른다.
import Link from "next/link";
import Image from "next/image";
import type { PublicArticle } from "@/lib/seo/article";
import { blogPaths } from "@/lib/seo/routes";

function formatKoDate(d: Date): string {
  // DESIGN.md: 날짜는 YYYY.MM.DD 점 표기
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())}`;
}

export default function ArticleCardList({ articles }: { articles: PublicArticle[] }) {
  return (
    <ul className="space-y-6">
      {articles.map((a) => {
        const cover = a.thumbnailUrl ?? a.coverPhotoUrl;
        return (
          <li key={a.id}>
            <article className="overflow-hidden rounded-2xl border border-slate-200">
              {cover && (
                <div className="relative aspect-[16/9] bg-slate-100">
                  <Image
                    src={cover}
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
        );
      })}
    </ul>
  );
}
