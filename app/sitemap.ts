// app/sitemap.ts — /sitemap.xml (T-seo-s1)
//
// 공개 대상은 전부 lib/seo/public-villa.ts 관문을 통과한 것만 들어온다(조회 조건 재작성 금지).
// ★ publicListed=false·품질 하한 미달 빌라는 여기에 절대 등장하지 않는다.
// ★ 패싯 페이지는 매칭 3개 미만이면 생성되지 않으므로 sitemap에도 안 실린다(껍데기 URL 방지).
//
// 빌라 0개 시점에도 정상 동작한다 — 정적 페이지만 실린 유효한 sitemap이 나온다.
import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo/base-url";
import { BLOG_ROOT, blogPaths } from "@/lib/seo/routes";
import { getPublicVillas } from "@/lib/seo/public-villa";
import { getPublishedArticles } from "@/lib/seo/article";
import { allFacetPages } from "@/lib/seo/facets";

// DB를 읽으므로 정적 프리렌더 금지 — 요청 시 생성 + 1시간 재검증.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // ★ sitemap에는 **실제로 200을 반환하는 URL만** 넣는다.
  //   존재하지 않는 URL을 올리면 서치어드바이저·Search Console에 크롤 오류가 쌓이고,
  //   사이트맵 전체의 신뢰도가 떨어진다(프로덕션 실측에서 /blog 404가 실제로 잡혔다).
  //   → `/blog` 허브는 S2에서 페이지가 생기면 그때 이 목록에 추가한다.
  const staticEntries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/intro.html"), lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/intro-vendor.html"), lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: absoluteUrl("/intro-partner.html"), lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];

  let villaEntries: MetadataRoute.Sitemap = [];
  let facetEntries: MetadataRoute.Sitemap = [];
  let articleEntries: MetadataRoute.Sitemap = [];

  try {
    // 가이드 글 — 발행분만. ★글이 1건 이상일 때만 /blog 허브를 등재한다(빈 허브 = 얇은 콘텐츠).
    const articles = await getPublishedArticles();
    if (articles.length > 0) {
      articleEntries.push({
        url: absoluteUrl(BLOG_ROOT),
        lastModified: articles[0].publishedAt,
        changeFrequency: "weekly",
        priority: 0.8,
      });
      for (const a of articles) {
        // images = 사이트맵 이미지 확장. 이미지 검색 색인 힌트이며, 본문 이미지까지 포함시킨다.
        //   ★ 절대 URL만 넣는다(루트 상대경로 브랜드 자산은 absoluteUrl로 승격).
        const imgs = [
          ...(a.coverPhotoUrl ? [a.coverPhotoUrl] : []),
          ...a.blocks.filter((b) => b.type === "img").map((b) => (b as { url: string }).url),
        ]
          .map((u) => (u.startsWith("/") ? absoluteUrl(u) : u))
          .filter((u, i, arr) => arr.indexOf(u) === i)
          .slice(0, 10);
        articleEntries.push({
          url: absoluteUrl(blogPaths.article(a.slug)),
          lastModified: a.updatedAt,
          changeFrequency: "monthly",
          priority: 0.7,
          ...(imgs.length > 0 ? { images: imgs } : {}),
        });
      }
    }
  } catch {
    articleEntries = [];
  }

  try {
    const villas = await getPublicVillas();

    villaEntries = villas.map((v) => ({
      url: absoluteUrl(blogPaths.villa(v.slug)),
      lastModified: v.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
      // 이미지 확장 — 이미지 검색 색인 힌트(빌라 사진은 곧 상품이라 유입 가치가 크다)
      ...(v.photos.length > 0 ? { images: v.photos.slice(0, 10).map((p) => p.url) } : {}),
      // 비디오 확장 — 발행된 유튜브 쇼츠. 영상은 파일 메타가 아니라 사이트맵·구조화 데이터로 색인된다.
      ...(v.videos.length > 0
        ? {
            videos: v.videos.map((vid) => ({
              title: vid.title,
              thumbnail_loc: `https://i.ytimg.com/vi/${vid.ytVideoId}/hqdefault.jpg`,
              description: vid.description.slice(0, 200),
              content_loc: `https://www.youtube.com/watch?v=${vid.ytVideoId}`,
              player_loc: `https://www.youtube.com/embed/${vid.ytVideoId}`,
              publication_date: (vid.publishedAt ?? v.updatedAt).toISOString(),
            })),
          }
        : {}),
    }));

    // 전체 목록 페이지 — 공개 빌라가 1곳이라도 있을 때만 등재(빈 목록 = 얇은 콘텐츠)
    if (villas.length > 0) {
      villaEntries.unshift({
        url: absoluteUrl(blogPaths.villas()),
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: 0.9,
      });
    }

    facetEntries = allFacetPages(villas).map((f) => ({
      url: absoluteUrl(f.path),
      lastModified: f.lastModified,
      changeFrequency: "weekly" as const,
      // 매칭이 많은 패싯일수록 유용한 랜딩 — 0.5~0.7 범위로 완만하게
      priority: Math.min(0.7, 0.5 + f.count / 100),
    }));
  } catch {
    // DB 장애 시에도 sitemap 자체는 200으로 응답해야 한다(빈 sitemap > 500).
    // 500이 반복되면 검색엔진이 sitemap 제출 자체를 무효 처리한다.
  }

  return [...staticEntries, ...articleEntries, ...villaEntries, ...facetEntries];
}
