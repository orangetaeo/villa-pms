// app/blog/page.tsx — 공개 콘텐츠 허브 (ko 캐논, ADR-0049)
//
// ★ 렌더·메타 본체는 components/seo/pages/blog-hub.tsx로 이관됐다(비-ko 라우트와 공용).
//   이 파일은 locale="ko" thin wrapper — 기존 /blog URL·출력은 변화 0(추가만).
import type { Metadata } from "next";
import { blogHubMetadata, BlogHubPage } from "@/components/seo/pages/blog-hub";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

export function generateMetadata(): Metadata {
  return blogHubMetadata("ko");
}

export default function BlogHub() {
  return <BlogHubPage locale="ko" />;
}
