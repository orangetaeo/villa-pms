// app/feed.xml/route.ts — RSS 2.0 (T-seo-s1)
//
// 네이버 서치어드바이저는 사이트맵과 별개로 **RSS 제출**을 받는다. 신규 콘텐츠 수집 속도가
// 사이트맵보다 빠른 경우가 있어 둘 다 제출한다.
// 소스는 공개 관문(getPublicVillas)만 — 여기서 별도 조회 조건을 만들지 않는다.
import { absoluteUrl } from "@/lib/seo/base-url";
import { BLOG_ROOT, blogPaths } from "@/lib/seo/routes";
import { getPublicVillas } from "@/lib/seo/public-villa";
import { getPublishedArticles } from "@/lib/seo/article";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

/** XML 텍스트 이스케이프 — 빌라명에 &·< 가 들어와도 피드가 깨지지 않게. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface FeedItem {
  title: string;
  path: string;
  description: string;
  pubDate: Date;
}

export async function GET() {
  const items: FeedItem[] = [];

  // 가이드 글이 RSS의 주 콘텐츠 — 네이버는 사이트맵보다 RSS 수집이 빠른 경우가 있다.
  try {
    const articles = await getPublishedArticles();
    for (const a of articles) {
      items.push({
        title: a.title,
        path: blogPaths.article(a.slug),
        description: a.summary.slice(0, 300),
        pubDate: a.publishedAt,
      });
    }
  } catch {
    // 글 조회 실패가 피드 전체를 깨뜨리지 않는다.
  }

  try {
    const villas = await getPublicVillas();
    for (const v of villas) {
      items.push({
        title: `${v.publicLabel} · 최대 ${v.maxGuests}인`,
        path: blogPaths.villa(v.slug),
        description: (v.description ?? "").slice(0, 300),
        pubDate: v.publicListedAt ?? v.updatedAt,
      });
    }
  } catch {
    // DB 장애 시에도 유효한 빈 피드를 반환한다(500 반복 = RSS 제출 무효화).
  }

  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Villa Go — 푸꾸옥 빌라</title>
    <link>${esc(absoluteUrl(BLOG_ROOT))}</link>
    <description>푸꾸옥 풀빌라·가족 빌라 정보</description>
    <language>ko</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items
  .map(
    (it) => `    <item>
      <title>${esc(it.title)}</title>
      <link>${esc(absoluteUrl(it.path))}</link>
      <guid isPermaLink="true">${esc(absoluteUrl(it.path))}</guid>
      <description>${esc(it.description)}</description>
      <pubDate>${it.pubDate.toUTCString()}</pubDate>
    </item>`
  )
  .join("\n")}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=1800",
    },
  });
}
