// /blog/area/[code] — 지역(단지)별 빌라 (T-seo-s2)
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadFacet } from "@/lib/seo/facet-page";
import FacetPageView from "@/lib/seo/facet-page";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ code: string }> };

async function load(code: string) {
  return loadFacet(blogPaths.area(code));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const d = await load(code);
  if (!d) return { title: "찾을 수 없는 지역 | Villa GO", robots: { index: false } };
  const name = d.areaNames[code] ?? code;
  return {
    title: `푸꾸옥 ${name} 빌라 ${d.villas.length}곳 | Villa GO`,
    description: `푸꾸옥 ${name} 단지의 빌라를 인원·시설 조건으로 골라보세요. 현지에서 직접 운영·검수합니다.`,
    alternates: { canonical: absoluteUrl(blogPaths.area(code)) },
  };
}

export default async function AreaFacetPage({ params }: Params) {
  const { code } = await params;
  const d = await load(code);
  if (!d) notFound();
  const name = d.areaNames[code] ?? code;
  return (
    <FacetPageView
      data={d}
      title={`푸꾸옥 ${name} 빌라`}
      intro={`${name} 단지에서 운영 중인 빌라입니다. 같은 단지라도 침실 수와 시설이 달라 인원과 일정에 맞춰 고르는 편이 좋습니다.`}
    />
  );
}
