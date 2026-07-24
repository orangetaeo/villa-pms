// app/blog/[slug]/page.tsx — 가이드 글 상세 (T-seo-s3)
//
// ★ 미발행(DRAFT·PENDING_APPROVAL·APPROVED·REJECTED)은 404 — 승인 전 초안이 URL로 새면
//   검수 게이트가 무의미해진다. 조회 게이트는 lib/seo/article.ts가 단독으로 책임진다.
// ★ 정적 세그먼트(/blog/villa·/blog/area 등)는 Next가 우선 매칭하므로 이 catch-all이 가로채지 않는다.
import Link from "next/link";
import { VillaGoHeaderLogo } from "@/components/brand/villa-go-header-logo";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedArticleBySlug } from "@/lib/seo/article";
import { getPublicVillaApproxMapEmbed } from "@/lib/seo/public-villa";
import { getPlaceArticleMap } from "@/lib/seo/public-place";
import { guideMapEmbed } from "@/lib/seo/guide-map-anchors";
import { getRecommendedVillas } from "@/lib/seo/recommended-villas";
import { getRelatedArticles } from "@/lib/seo/related-articles";
import { seoArticleCategoryLabel } from "@/lib/seo/categories";
import { ARTICLE_AUTHOR_LD, ARTICLE_BYLINE, buildBreadcrumbLd, buildVideoObjectLd } from "@/lib/seo/article-jsonld";
import { getVideoShortDurationSec } from "@/lib/seo/video-article";
import ArticleBody from "@/components/seo/article-body";
import ArticleCardList from "@/components/seo/article-card-list";
import VillaList from "@/components/seo/villa-list";
import { blogPaths, BLOG_ROOT } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { BRAND_FALLBACK_IMAGE } from "@/lib/seo/article-draft";
// ADR-0049: ko 캐논도 번역본으로의 hreflang을 내보내야 비-ko 페이지와 상호 대칭이 성립한다.
import { getArticleAvailableLocales, articleAlternates } from "@/lib/seo/article-i18n";
import type { PublicLocale } from "@/lib/seo/public-i18n";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const a = await getPublishedArticleBySlug(slug).catch(() => null);
  if (!a) return { title: "찾을 수 없는 글 | Villa GO", robots: { index: false } };
  const url = absoluteUrl(blogPaths.article(a.slug));
  const available = await getArticleAvailableLocales(a.id).catch((): PublicLocale[] => ["ko"]);
  return {
    title: `${a.title} | Villa GO`,
    description: a.summary,
    alternates: { canonical: url, ...articleAlternates(a.slug, available) },
    openGraph: {
      type: "article",
      siteName: "Villa GO",
      title: a.title,
      description: a.summary,
      url,
      locale: "ko_KR",
      publishedTime: a.publishedAt.toISOString(),
      // ★ OG 이미지는 항상 채운다 — 카톡·SNS 공유 시 썸네일 유무가 클릭률을 가른다.
      //   커버가 없으면 브랜드 이미지로 폴백(빈 썸네일보다 낫다).
      images: [{ url: absoluteUrl(a.coverPhotoUrl ?? BRAND_FALLBACK_IMAGE) }],
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

  // 빌라 글에는 **대략 위치** 지도를 붙인다(로컬 SEO 신호 + 체류시간). 정확 핀은 넣지 않는다
  //   (원칙 1: 재고 비공개) — 서버에서 좌표를 ~1km로 뭉갠 임베드 URL만 받는다. 비-빌라 글은 지도 없음.
  const villaMapEmbed =
    article.category === "villa" && article.relatedVillaIds[0]
      ? await getPublicVillaApproxMapEmbed(article.relatedVillaIds[0]).catch(() => null)
      : null;

  // 장소 글(맛집·카페 등)은 **정밀** 지도 + LocalBusiness/Restaurant geo 구조화 데이터를 붙인다.
  //   남의 공개 영업점이라 위치를 숨길 이유가 없고, 지역 검색 리치결과(로컬 SEO)의 핵심 신호다.
  const placeMap =
    article.category === "place" ? await getPlaceArticleMap(article.id).catch(() => null) : null;

  // 가이드 글은 지리 앵커가 명확한 토픽(공항 이동 등)에만 지도를 붙인다(GUIDE_MAP_ANCHORS 큐레이션).
  const guideMap = article.category === "guide" ? guideMapEmbed(article.slug) : null;

  // 하단 "추천 빌라" — 글 성격별 출처(place=지역매칭·villa=동일지역·그외=relatedVillaIds)로 최대 3장.
  //   ★ 반드시 public-villa 관문 경유(getRecommendedVillas 내부). 못 뽑으면 빈 배열 → 섹션 숨김(억지 추천 금지).
  const recommendedVillas = await getRecommendedVillas({
    id: article.id,
    category: article.category,
    relatedVillaIds: article.relatedVillaIds,
  }).catch(() => []);
  // 제목 — 지역성이 있는 글(place·villa)은 "이 지역 추천 빌라", 그 외는 "추천 빌라".
  const recommendTitle =
    article.category === "place" || article.category === "villa" ? "이 지역 추천 빌라" : "추천 빌라";

  // 하단 "관련 글" — 내부 링크(SEO 신호 + 다음 글로 이어지는 회유). ★공개 게이트(getPublishedArticles)
  //   경유분만. 못 뽑으면 빈 배열 → 섹션 숨김(억지 링크 금지). 장소 글은 같은 지역을 우선한다.
  const relatedArticles = await getRelatedArticles({ id: article.id, category: article.category }).catch(() => []);
  // 제목 — 장소 글이면 "이 지역 다른 볼거리", 그 외는 "관련 글".
  const relatedTitle = article.category === "place" ? "이 지역 다른 볼거리" : "관련 글";

  // 카테고리 라벨 — 화면 브레드크럼용. BreadcrumbList 구조화 데이터도 같은 라벨을 쓴다(항상 일치).
  const categoryLabel = seoArticleCategoryLabel(article.category);

  // 장소 구조화 데이터 — Article과 별개 스크립트로 낸다. geo는 좌표가 있을 때만.
  const placeLd = placeMap
    ? {
        "@context": "https://schema.org",
        "@type": placeMap.schemaType,
        name: placeMap.name,
        ...(placeMap.area
          ? { address: { "@type": "PostalAddress", addressLocality: placeMap.area, addressCountry: "VN" } }
          : {}),
        ...(placeMap.lat != null && placeMap.lng != null
          ? { geo: { "@type": "GeoCoordinates", latitude: placeMap.lat, longitude: placeMap.lng } }
          : {}),
        hasMap: placeMap.mapLink,
        mainEntityOfPage: absoluteUrl(blogPaths.article(article.slug)),
      }
    : null;

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
    // author — E-E-A-T 신호. 실명 노출 금지(익명 원칙)라 브랜드 에디토리얼 주체를 저자로 둔다.
    //   화면 바이라인(ARTICLE_BYLINE)과 동일 주체다.
    author: ARTICLE_AUTHOR_LD,
    publisher: { "@type": "Organization", name: "Villa GO" },
    // image는 구글 Article 구조화 데이터 **권장 필드** — 비어 있으면 리치 결과 자격을 잃는다.
    //   커버 + 본문 이미지를 함께 넣어 어떤 컷이 대표로 뽑혀도 되게 한다.
    image: [
      absoluteUrl(article.coverPhotoUrl ?? BRAND_FALLBACK_IMAGE),
      ...article.blocks
        .filter((b) => b.type === "img")
        .map((b) => (b as { url: string }).url)
        .map((u) => (u.startsWith("/") ? absoluteUrl(u) : u)),
    ].filter((u, i, arr) => arr.indexOf(u) === i),
  };

  // BreadcrumbList — 화면 브레드크럼(가이드 → 카테고리 → 현재 글)과 정확히 일치시킨다.
  //   ★ 구조화 데이터는 화면에 실제 존재하는 계층만 반영한다(스키마=화면 일치 규율).
  const breadcrumbLd = buildBreadcrumbLd(article);

  // 영상 글(category="video")은 VideoObject를 Article과 **병기**한다(ADR-0049 §6). 임베드는 본문 video 블록 재사용.
  //   duration은 원천 쇼츠(YoutubeShort.durationSec)를 ytVideoId로 별도 조회 → 조회 불가·0이면 필드 자체를 생략.
  const videoBlock =
    article.category === "video" ? article.blocks.find((b) => b.type === "video") : undefined;
  const videoLd =
    videoBlock && videoBlock.type === "video"
      ? buildVideoObjectLd({
          title: article.title,
          summary: article.summary,
          slug: article.slug,
          ytVideoId: videoBlock.ytVideoId,
          coverPhotoUrl: article.coverPhotoUrl,
          publishedAt: article.publishedAt,
          durationSec: await getVideoShortDurationSec(videoBlock.ytVideoId).catch(() => null),
        })
      : null;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script
        type="application/ld+json"
        // JSON.stringify 결과만 주입 — 사용자 입력 HTML이 아니라 직렬화된 데이터다.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {placeLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(placeLd).replace(/</g, "\\u003c") }}
        />
      )}
      {videoLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(videoLd).replace(/</g, "\\u003c") }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd).replace(/</g, "\\u003c") }}
      />

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <VillaGoHeaderLogo />
        <Link
          href="/chat?src=seo"
          className="rounded-full border border-teal-600 px-3 py-1.5 text-sm font-semibold text-teal-700"
        >
          상담하기
        </Link>
      </header>

      <article className="px-5 py-8">
        {/* 화면 브레드크럼 — BreadcrumbList 구조화 데이터와 동일 계층(가이드 → 카테고리). */}
        <nav className="flex flex-wrap items-center gap-1 text-xs text-slate-400">
          <Link href={BLOG_ROOT} className="hover:underline">
            푸꾸옥 여행 가이드
          </Link>
          <span aria-hidden>›</span>
          <Link href={blogPaths.categoryList(article.category)} className="hover:underline">
            {categoryLabel}
          </Link>
        </nav>
        <h1 className="mt-2 text-2xl font-extrabold leading-snug">{article.title}</h1>
        {/* 날짜 + 바이라인 — "직접 방문 후 작성"은 Experience(E-E-A-T) 신호를 데이터로 뒷받침한다. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
          <span className="tabular-nums">{formatKoDate(article.publishedAt)}</span>
          <span aria-hidden>·</span>
          <span>{ARTICLE_BYLINE}</span>
        </div>

        {article.coverPhotoUrl && (
          <div className="relative mt-5 aspect-[16/9] overflow-hidden rounded-2xl bg-slate-100">
            <Image
              src={article.coverPhotoUrl}
              // ★ 커버 alt를 비워두지 않는다 — 이미지 검색 색인은 alt 텍스트에 달려 있고,
              //   글 대표 이미지가 무엇에 대한 사진인지 설명하는 것이 제목 그 자체다.
              alt={article.title}
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

        {/* 위치(대략) — 빌라 글에만. 정확 핀 대신 동네 수준만 보여준다(원칙 1). */}
        {villaMapEmbed && (
          <section className="mt-10">
            <h2 className="text-lg font-bold">위치</h2>
            <p className="mt-1 text-sm text-slate-500">정확한 주소는 예약 확정 후 안내드립니다. 아래는 대략적인 위치예요.</p>
            <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <iframe
                src={villaMapEmbed}
                title="빌라 대략 위치 지도"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          </section>
        )}

        {/* 위치 — 장소 글(공개 영업점)은 정밀 지도 + "구글 지도에서 열기" 링크. */}
        {placeMap && (
          <section className="mt-10">
            <h2 className="text-lg font-bold">위치</h2>
            {placeMap.area && <p className="mt-1 text-sm text-slate-500">푸꾸옥 {placeMap.area}</p>}
            <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <iframe
                src={placeMap.embedUrl}
                title={`${placeMap.name} 위치 지도`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
            <a
              href={placeMap.mapLink}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-2 inline-block text-sm font-semibold text-teal-700 hover:underline"
            >
              구글 지도에서 열기 →
            </a>
          </section>
        )}

        {/* 위치 — 지리 앵커가 있는 가이드 글에만(공항 이동 등). 검색어 기반 임베드. */}
        {guideMap && (
          <section className="mt-10">
            <h2 className="text-lg font-bold">{guideMap.label} 위치</h2>
            <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <iframe
                src={guideMap.embedUrl}
                title={`${guideMap.label} 위치 지도`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          </section>
        )}

        {/* 추천 빌라 — ★공개 관문(getRecommendedVillas → public-villa) 통과분만. 카드엔 가격·공실 0(VillaList).
            못 뽑으면 섹션 자체를 렌더하지 않는다(억지 추천 금지). */}
        {recommendedVillas.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold">{recommendTitle}</h2>
            <div className="mt-3">
              <VillaList villas={recommendedVillas} />
            </div>
          </section>
        )}

        {/* 관련 글 — 내부 링크(SEO 신호 + 회유). 공개 게이트 통과분만, 못 뽑으면 섹션 숨김.
            SeoArticle엔 민감 필드가 없어 카드 재사용(ArticleCardList)에 누수 없음. */}
        {relatedArticles.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold">{relatedTitle}</h2>
            <div className="mt-3">
              <ArticleCardList articles={relatedArticles} />
            </div>
          </section>
        )}

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
