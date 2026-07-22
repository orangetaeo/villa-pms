// /blog/bedrooms/[n] — 침실 수별 빌라 (T-seo-s2)
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FacetPageView, { loadFacet } from "@/lib/seo/facet-page";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ n: string }> };

function parseN(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n <= 20 ? n : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { n: raw } = await params;
  const n = parseN(raw);
  const d = n ? await loadFacet(blogPaths.bedrooms(n)) : null;
  if (!d || !n) return { title: "찾을 수 없는 조건 | Villa GO", robots: { index: false } };
  return {
    title: `침실 ${n}개 이상 푸꾸옥 빌라 ${d.villas.length}곳 | Villa GO`,
    description: `침실 ${n}개 이상 푸꾸옥 빌라 모음. 가족·단체 여행에 맞는 구성을 골라보세요.`,
    alternates: { canonical: absoluteUrl(blogPaths.bedrooms(n)) },
  };
}

export default async function BedroomsFacetPage({ params }: Params) {
  const { n: raw } = await params;
  const n = parseN(raw);
  const d = n ? await loadFacet(blogPaths.bedrooms(n)) : null;
  if (!d || !n) notFound();
  return (
    <FacetPageView
      data={d}
      title={`침실 ${n}개 이상 푸꾸옥 빌라`}
      intro={`침실이 ${n}개 이상인 빌라입니다. 같은 침실 수라도 침대 구성과 전용 욕실 유무가 달라 실제 수용 인원이 다를 수 있습니다.`}
    />
  );
}
