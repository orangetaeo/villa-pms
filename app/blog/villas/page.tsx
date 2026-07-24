// /blog/villas — 공개 빌라 전체 목록 + 조건 탐색 (T-seo-s2)
//
// ★ 테오 결정(2026-07-22): 소비자가 조건으로 찾는 사이트. 목록·필터를 연다.
//   감수하는 대가 = 경쟁사도 라인업을 조건별로 열람할 수 있다. 300~400개 규모의 소비자
//   사이트에서 검색을 막으면 사이트가 성립하지 않으므로 이 비용은 치르고 간다.
// ★ 날짜(공실) 필터는 없다 — 원칙 1(재고 비공개).
import Link from "next/link";
import { VillaGoHeaderLogo } from "@/components/brand/villa-go-header-logo";
import type { Metadata } from "next";
import { getPublicVillas } from "@/lib/seo/public-villa";
import { allFacetPages } from "@/lib/seo/facets";
import { BLOG_ROOT, blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import VillaList from "@/components/seo/villa-list";
import FacetNav from "@/components/seo/facet-nav";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "푸꾸옥 빌라 전체 목록 | Villa GO",
    description: "현지에서 직접 운영·검수하는 푸꾸옥 빌라를 인원·시설 조건으로 찾아보세요.",
    alternates: { canonical: absoluteUrl(blogPaths.villas()) },
    openGraph: {
      type: "website",
      siteName: "Villa GO",
      title: "푸꾸옥 빌라 전체 목록",
      description: "인원·시설 조건으로 고르는 푸꾸옥 현지 빌라.",
      url: absoluteUrl(blogPaths.villas()),
      locale: "ko_KR",
    },
  };
}

export default async function VillasIndexPage() {
  let villas: Awaited<ReturnType<typeof getPublicVillas>> = [];
  try {
    villas = await getPublicVillas();
  } catch {
    villas = [];
  }
  const facets = allFacetPages(villas);
  const areaNames: Record<string, string> = {};
  for (const v of villas) {
    if (v.areaCode) areaNames[v.areaCode] = v.areaNameKo ?? v.areaName ?? v.areaCode;
  }

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
        <h1 className="text-2xl font-extrabold leading-snug">푸꾸옥 빌라</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          현지에서 직접 운영하고 청소 검수를 통과한 빌라만 안내합니다. 날짜별 이용 가능 여부와 견적은 상담으로
          확인해드립니다.
        </p>
        <p className="mt-2 text-sm font-semibold text-teal-700">빌라 {villas.length}곳</p>
      </section>

      {facets.length > 0 && (
        <section className="px-5 pb-6">
          <FacetNav facets={facets} areaNames={areaNames} />
        </section>
      )}

      <section className="px-5 pb-10">
        <VillaList villas={villas} />
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
