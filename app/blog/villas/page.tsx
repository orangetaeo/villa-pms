// app/blog/villas/page.tsx — 공개 빌라 전체 목록 (ko 캐논, T-seo-s2 · ADR-0050)
//
// ★ 렌더·메타 본체는 components/seo/pages/villas-page.tsx로 이관됐다(비-ko 라우트와 공용).
//   이 파일은 locale="ko" thin wrapper — 기존 /blog/villas 출력은 추가(hreflang)만.
import type { Metadata } from "next";
import { villasMetadata, VillasIndexPage } from "@/components/seo/pages/villas-page";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

export async function generateMetadata(): Promise<Metadata> {
  return villasMetadata("ko");
}

export default async function VillasIndexRoute() {
  return <VillasIndexPage locale="ko" />;
}
