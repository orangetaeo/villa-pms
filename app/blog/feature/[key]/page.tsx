// /blog/feature/[key] — 시설·특징별 빌라 (T-seo-s2)
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FacetPageView, { loadFacet } from "@/lib/seo/facet-page";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ key: string }> };

const FEATURE_KO: Record<string, string> = {
  viewSea: "바다뷰",
  viewMountain: "마운틴뷰",
  viewCity: "시티뷰",
  bbq: "BBQ 가능",
  elevator: "엘리베이터",
  generator: "발전기",
  kidsPool: "키즈풀",
  privatePool: "프라이빗 풀",
  gym: "헬스장",
  golfNearby: "골프장 인근",
  beachFront: "해변 바로앞",
  marketNearby: "시장 인근",
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key } = await params;
  const d = await loadFacet(blogPaths.feature(key));
  if (!d) return { title: "찾을 수 없는 조건 | Villa GO", robots: { index: false } };
  const label = FEATURE_KO[key] ?? key;
  return {
    title: `${label} 푸꾸옥 빌라 ${d.villas.length}곳 | Villa GO`,
    description: `${label} 조건을 갖춘 푸꾸옥 빌라 모음. 인원과 일정에 맞춰 견적을 받아보세요.`,
    alternates: { canonical: absoluteUrl(blogPaths.feature(key)) },
  };
}

export default async function FeatureFacetPage({ params }: Params) {
  const { key } = await params;
  const d = await loadFacet(blogPaths.feature(key));
  if (!d) notFound();
  const label = FEATURE_KO[key] ?? key;
  return (
    <FacetPageView
      data={d}
      title={`${label} 푸꾸옥 빌라`}
      intro={`${label} 조건을 갖춘 빌라입니다. 같은 조건이라도 규모와 위치가 달라 실제 사진과 구성을 함께 확인하시는 편이 좋습니다.`}
    />
  );
}
