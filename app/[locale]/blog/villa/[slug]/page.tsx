// app/[locale]/blog/villa/[slug]/page.tsx — 비-ko 빌라 상세 (en·vi·ru·zh, ADR-0050)
//
// ★ 비-ko도 항상 200(빌라 자체가 없을 때만 404). description READY 없으면 소개 섹션 생략(본체가 처리).
// ★ "ko"는 프리픽스 없는 /blog/villa/[slug]로 301. 잡값 로케일은 404.
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { villaMetadata, VillaPage } from "@/components/seo/pages/villa-page";
import { parseBlogLocaleParam } from "@/lib/seo/blog-locale";
import { blogPaths } from "@/lib/seo/routes";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  const l = parseBlogLocaleParam(locale);
  if (!l) return { title: "404 | Villa GO", robots: { index: false } };
  return villaMetadata(slug, l);
}

export default async function LocaleVillaDetail({ params }: Params) {
  const { locale, slug } = await params;
  if (locale === "ko") permanentRedirect(blogPaths.villa(slug));
  const l = parseBlogLocaleParam(locale);
  if (!l) notFound();
  return <VillaPage slug={slug} locale={l} />;
}
