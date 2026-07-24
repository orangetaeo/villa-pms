// lib/seo/facet-page.tsx — 패싯 페이지 공용 렌더 (T-seo-s2 · ADR-0050 로케일화)
//
// area·feature·guests·bedrooms 4종 페이지가 같은 뼈대를 쓴다. 각 라우트는 파라미터 해석과
// 메타데이터만 담당하고, 데이터 조회·가드·렌더는 전부 여기로 모은다(조회 조건 재작성 금지).
//
// ★ 매칭 3개 미만이면 notFound() — 껍데기 목록 페이지를 만들지 않는다(얇은 콘텐츠 = 저품질 신호).
//   패싯 산출(allFacetPages)이 이미 3개 미만을 제외하므로 sitemap에도 실리지 않는다. 여기서는
//   직접 URL로 들어온 경우를 404로 막는다.
// ★ 로케일(기본 ko): loadFacet은 **무변경**(패싯 정체성은 ko 경로) — 렌더 단에서만 로케일 접두·라벨화.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicVillas } from "@/lib/seo/public-villa";
import { allFacetPages, filterByFacet, type FacetPage } from "@/lib/seo/facets";
import { blogPaths } from "@/lib/seo/routes";
import VillaList from "@/components/seo/villa-list";
import FacetNav from "@/components/seo/facet-nav";
import { BlogHeader } from "@/components/seo/pages/blog-header";
import { PUBLIC_LOCALES, type PublicLocale } from "@/lib/seo/public-i18n";
import { blogLocalePrefix } from "@/lib/seo/blog-locale";
import { blogStrings } from "@/lib/seo/blog-i18n";
import { villaStrings } from "@/lib/seo/villa-i18n";

export interface FacetPageData {
  facet: FacetPage;
  villas: Awaited<ReturnType<typeof getPublicVillas>>;
  facets: FacetPage[];
  areaNames: Record<string, string>;
}

/** 경로에 해당하는 살아있는 패싯을 찾는다. 없으면 null(호출부가 404). ★ 로케일 무관(ko 경로로 매칭). */
export async function loadFacet(path: string): Promise<FacetPageData | null> {
  let all: Awaited<ReturnType<typeof getPublicVillas>> = [];
  try {
    all = await getPublicVillas();
  } catch {
    return null;
  }
  // 나브(FacetNav)는 살아있는(≥3) 패싯만 보여준다 — 얇은 조합을 링크로 늘어놓지 않는다.
  const facets = allFacetPages(all);
  // ★ 현재 페이지 자체는 매칭 1곳 이상이면 연다(온사이트 필터가 작동해야 한다는 요구).
  //   3곳 미만이면 라우트가 noindex로 색인만 막는다(loadFacet은 페이지 존재만 판단).
  const facet = allFacetPages(all, 1).find((f) => f.path === path);
  if (!facet) return null;

  const areaNames: Record<string, string> = {};
  for (const v of all) {
    if (v.areaCode) areaNames[v.areaCode] = v.areaNameKo ?? v.areaName ?? v.areaCode;
  }
  return { facet, villas: filterByFacet(all, facet.params), facets, areaNames };
}

export default function FacetPageView({
  data,
  title,
  intro,
  locale = "ko",
}: {
  data: FacetPageData;
  title: string;
  intro: string;
  locale?: PublicLocale;
}) {
  if (!data) notFound();
  const { villas, facets, areaNames, facet } = data;
  const chrome = blogStrings(locale);
  const t = villaStrings(locale);
  // 언어 스위처 — 같은 패싯의 각 로케일 URL(패싯 path는 ko 경로라 프리픽스만 붙인다).
  const langLinks: Partial<Record<PublicLocale, string>> = Object.fromEntries(
    PUBLIC_LOCALES.map((l) => [l.code, `${blogLocalePrefix(l.code)}${facet.path}`]),
  );

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <BlogHeader locale={locale} links={langLinks} consultLabel={chrome.consult} />

      <section className="px-5 py-6">
        {/* 각 패싯 페이지는 고유 H1·도입문을 갖는다 — 목록만 있는 껍데기가 아니라 "페이지"여야 한다 */}
        <h1 className="text-2xl font-extrabold leading-snug">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{intro}</p>
        <p className="mt-2 text-sm font-semibold text-teal-700">{t.villaCount(villas.length)}</p>
      </section>

      <section className="px-5 pb-6">
        <VillaList villas={villas} locale={locale} />
      </section>

      <section className="border-t border-slate-100 px-5 py-8">
        <FacetNav facets={facets} areaNames={areaNames} currentPath={facet.path} locale={locale} />
      </section>

      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p>
          <Link href={blogPaths.hub(locale)} className="font-semibold text-teal-700">
            {chrome.backToGuide}
          </Link>
        </p>
        <p className="mt-3">
          <Link href="/privacy" className="underline">
            {chrome.privacy}
          </Link>
        </p>
      </footer>
    </div>
  );
}
