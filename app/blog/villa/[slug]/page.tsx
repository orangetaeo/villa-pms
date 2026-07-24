// app/blog/villa/[slug]/page.tsx — 공개 빌라 상세 (ko 캐논, T-seo-s2 · ADR-0050)
//
// ★ 렌더·메타 본체는 components/seo/pages/villa-page.tsx로 이관됐다(비-ko 라우트와 공용).
//   이 파일은 locale="ko" thin wrapper — 기존 /blog/villa/[slug] URL·출력은 추가(hreflang)만.
// ★ 절대 넣지 않는 것(T-seo-s1 §4.1)은 본체·관문(public-villa.ts)이 책임진다.
import type { Metadata } from "next";
import { villaMetadata, VillaPage } from "@/components/seo/pages/villa-page";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return villaMetadata(slug, "ko");
}

export default async function PublicVillaPage({ params }: Params) {
  const { slug } = await params;
  return <VillaPage slug={slug} locale="ko" />;
}
