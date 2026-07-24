// lib/seo/blog-locale.ts — 공개 블로그 다국어 로케일 (순수 모듈, ADR-0049)
//
// ★ 이 파일은 순수 상수·함수만 둔다(next/headers·prisma import 금지) — routes.ts·클라이언트가 import한다.
// ★ ko는 캐논이라 여기 없다(프리픽스 없는 /blog). 여기 있는 4개만 /{locale}/blog 프리픽스를 갖는다.
import type { PublicLocale } from "@/lib/seo/public-i18n";

/** 번역 대상 언어(캐논 ko 제외). SeoArticleTranslation.locale 값의 정본. */
export const NON_KO_BLOG_LOCALES = ["en", "vi", "ru", "zh"] as const;

export type NonKoBlogLocale = (typeof NON_KO_BLOG_LOCALES)[number];

const NON_KO_SET = new Set<string>(NON_KO_BLOG_LOCALES);

/** URL 세그먼트(비신뢰 입력) → 비-ko 블로그 로케일. ko·미지원·잡값은 null(호출부가 404·리다이렉트 결정). */
export function parseBlogLocaleParam(v: string | null | undefined): NonKoBlogLocale | null {
  return typeof v === "string" && NON_KO_SET.has(v) ? (v as NonKoBlogLocale) : null;
}

/** 비-ko 블로그 로케일인지 — SeoArticleTranslation.locale 값 검증용(READY 행 병합 전 방어). */
export function isNonKoBlogLocale(v: string): v is NonKoBlogLocale {
  return NON_KO_SET.has(v);
}

/** 블로그 경로 프리픽스 — ko는 빈 문자열(캐논), 비-ko는 `/{locale}`. */
export function blogLocalePrefix(l: PublicLocale): string {
  return l === "ko" ? "" : `/${l}`;
}
