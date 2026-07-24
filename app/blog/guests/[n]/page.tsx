// /blog/guests/[n] — 인원별 빌라 (T-seo-s2)
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FacetPageView, { loadFacet } from "@/lib/seo/facet-page";
import { MIN_FACET_VILLAS } from "@/lib/seo/facets";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ n: string }> };

function parseN(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { n: raw } = await params;
  const n = parseN(raw);
  const d = n ? await loadFacet(blogPaths.guests(n)) : null;
  if (!d || !n) return { title: "찾을 수 없는 조건 | Villa GO", robots: { index: false } };
  return {
    title: `${n}인 이상 푸꾸옥 빌라 ${d.villas.length}곳 | Villa GO`,
    description: `${n}명 이상이 함께 묵을 수 있는 푸꾸옥 빌라. 방 배정과 동선까지 상담으로 도와드립니다.`,
    alternates: { canonical: absoluteUrl(blogPaths.guests(n)) },
    robots: { index: d.facet.count >= MIN_FACET_VILLAS, follow: true },
  };
}

export default async function GuestsFacetPage({ params }: Params) {
  const { n: raw } = await params;
  const n = parseN(raw);
  const d = n ? await loadFacet(blogPaths.guests(n)) : null;
  if (!d || !n) notFound();
  return (
    <FacetPageView
      data={d}
      title={`${n}인 이상 푸꾸옥 빌라`}
      intro={`${n}명 이상이 함께 묵을 수 있는 빌라입니다. 인원이 많을수록 침실 구성과 침대 종류를 먼저 확인하는 편이 좋습니다.`}
    />
  );
}
