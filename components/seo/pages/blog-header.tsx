// components/seo/pages/blog-header.tsx — 공개 블로그 공통 헤더 (로고 + 언어 스위처 + 상담 CTA)
//
// ★ 다국어(ADR-0049): 언어 스위처에 links를 넘겨 현재 페이지의 언어별 URL로 이동시킨다.
//   블로그는 콘텐츠 언어의 진실원천이 URL이므로(쿠키 아님) links가 항상 주어진다.
import Link from "next/link";
import { VillaGoHeaderLogo } from "@/components/brand/villa-go-header-logo";
import PublicLangSwitcher from "@/components/seo/public-lang-switcher";
import type { PublicLocale } from "@/lib/seo/public-i18n";

export function BlogHeader({
  locale,
  links,
  consultLabel,
}: {
  locale: PublicLocale;
  links: Partial<Record<PublicLocale, string>>;
  consultLabel: string;
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
      <VillaGoHeaderLogo />
      <div className="flex items-center gap-1.5">
        <PublicLangSwitcher current={locale} links={links} />
        <Link
          href="/chat?src=seo"
          className="rounded-full border border-teal-600 px-3 py-1.5 text-sm font-semibold text-teal-700"
        >
          {consultLabel}
        </Link>
      </div>
    </header>
  );
}
