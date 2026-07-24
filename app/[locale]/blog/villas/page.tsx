// app/[locale]/blog/villas/page.tsx — 비-ko 빌라 전체 목록 (en·vi·ru·zh, ADR-0050)
//
// ★ "ko"는 프리픽스 없는 /blog/villas로 301. 잡값 로케일은 404. 비-ko도 항상 200.
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { villasMetadata, VillasIndexPage } from "@/components/seo/pages/villas-page";
import { parseBlogLocaleParam } from "@/lib/seo/blog-locale";
import { blogPaths } from "@/lib/seo/routes";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const l = parseBlogLocaleParam(locale);
  if (!l) return { title: "404 | Villa GO", robots: { index: false } };
  return villasMetadata(l);
}

export default async function LocaleVillasIndex({ params }: Params) {
  const { locale } = await params;
  if (locale === "ko") permanentRedirect(blogPaths.villas());
  const l = parseBlogLocaleParam(locale);
  if (!l) notFound();
  return <VillasIndexPage locale={l} />;
}
