// lib/seo/facet-page.tsx — 패싯 페이지 공용 렌더 (T-seo-s2)
//
// area·feature·guests·bedrooms 4종 페이지가 같은 뼈대를 쓴다. 각 라우트는 파라미터 해석과
// 메타데이터만 담당하고, 데이터 조회·가드·렌더는 전부 여기로 모은다(조회 조건 재작성 금지).
//
// ★ 매칭 3개 미만이면 notFound() — 껍데기 목록 페이지를 만들지 않는다(얇은 콘텐츠 = 저품질 신호).
//   패싯 산출(allFacetPages)이 이미 3개 미만을 제외하므로 sitemap에도 실리지 않는다. 여기서는
//   직접 URL로 들어온 경우를 404로 막는다.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicVillas } from "@/lib/seo/public-villa";
import { allFacetPages, filterByFacet, type FacetPage } from "@/lib/seo/facets";
import { BLOG_ROOT } from "@/lib/seo/routes";
import VillaList from "@/components/seo/villa-list";
import FacetNav from "@/components/seo/facet-nav";

export interface FacetPageData {
  facet: FacetPage;
  villas: Awaited<ReturnType<typeof getPublicVillas>>;
  facets: FacetPage[];
  areaNames: Record<string, string>;
}

/** 경로에 해당하는 살아있는 패싯을 찾는다. 없으면 null(호출부가 404). */
export async function loadFacet(path: string): Promise<FacetPageData | null> {
  let all: Awaited<ReturnType<typeof getPublicVillas>> = [];
  try {
    all = await getPublicVillas();
  } catch {
    return null;
  }
  const facets = allFacetPages(all);
  const facet = facets.find((f) => f.path === path);
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
}: {
  data: FacetPageData;
  title: string;
  intro: string;
}) {
  if (!data) notFound();
  const { villas, facets, areaNames, facet } = data;

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

      <section className="px-5 py-6">
        {/* 각 패싯 페이지는 고유 H1·도입문을 갖는다 — 목록만 있는 껍데기가 아니라 "페이지"여야 한다 */}
        <h1 className="text-2xl font-extrabold leading-snug">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{intro}</p>
        <p className="mt-2 text-sm font-semibold text-teal-700">빌라 {villas.length}곳</p>
      </section>

      <section className="px-5 pb-6">
        <VillaList villas={villas} />
      </section>

      <section className="border-t border-slate-100 px-5 py-8">
        <FacetNav facets={facets} areaNames={areaNames} currentPath={facet.path} />
      </section>

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
