// components/seo/article-card-list.tsx — 블로그 글 카드 목록 (T-seo-category)
//
// 카테고리 목록 페이지가 쓰는 공용 카드 목록. 허브(app/blog/page.tsx)의 카드 마크업과
// 동일한 형태를 따르되, 썸네일은 thumbnailUrl ?? coverPhotoUrl 순으로 고른다.
import Link from "next/link";
import Image from "next/image";
import type { PublicArticle } from "@/lib/seo/article";
import { blogPaths } from "@/lib/seo/routes";
import type { PublicLocale } from "@/lib/seo/public-i18n";

// 카드 렌더에 실제로 필요한 최소 필드만 요구한다(구조적 최소 타입).
// PublicArticle[](카테고리 목록)·RelatedArticleCard[](관련 글) 둘 다 이 형태의 상위집합이라
// 그대로 넘길 수 있다 — 컴포넌트를 두 벌 만들지 않는다.
type ArticleCardData = Pick<
  PublicArticle,
  "id" | "slug" | "title" | "summary" | "thumbnailUrl" | "coverPhotoUrl" | "publishedAt"
>;

function formatKoDate(d: Date): string {
  // DESIGN.md: 날짜는 YYYY.MM.DD 점 표기
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())}`;
}

// locale은 상세 링크에만 반영(기본 ko = 기존 호출부 무영향, ADR-0049).
export default function ArticleCardList({
  articles,
  locale = "ko",
}: {
  articles: ArticleCardData[];
  locale?: PublicLocale;
}) {
  return (
    <ul className="space-y-6">
      {articles.map((a) => {
        const cover = a.thumbnailUrl ?? a.coverPhotoUrl;
        return (
          <li key={a.id}>
            {/* 카드 전체를 링크로 감싼다 — 제목뿐 아니라 이미지·요약 어디를 눌러도 상세로 이동. */}
            <Link href={blogPaths.article(a.slug, locale)} className="group block">
              <article className="overflow-hidden rounded-2xl border border-slate-200 transition group-hover:border-teal-300 group-hover:shadow-sm">
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
                  <h2 className="text-lg font-bold group-hover:text-teal-700">{a.title}</h2>
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">{a.summary}</p>
                  <p className="mt-2 text-xs text-slate-400 tabular-nums">{formatKoDate(a.publishedAt)}</p>
                </div>
              </article>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
