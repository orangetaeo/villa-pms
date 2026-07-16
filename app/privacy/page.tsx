import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import {
  PRIVACY_POLICY,
  PRIVACY_LANGS,
  PRIVACY_LANG_NATIVE,
  PRIVACY_LOCALE_COOKIE,
  PRIVACY_EFFECTIVE_DATE,
  resolvePrivacyLang,
  type PolicyBlock,
} from "@/lib/privacy-policy";

/**
 * /privacy — 개인정보처리방침 공개 페이지 (비로그인, ko 기본 + en·vi 전환)
 *
 * 공개 경로: 미들웨어 보호 목록(운영·공급자·vendor·partner)에 없어 인증 게이트 없이 통과.
 * 언어: ?lang= 파라미터 > p-locale 쿠키(/p와 공유) > ko. 지원 외(ru/zh)는 ko 폴백.
 * 언어 전환은 서버 렌더 쿼리 링크(?lang=)로 처리 — 클라이언트 JS 불필요.
 * 콘텐츠는 lib/privacy-policy.ts 3언어 사전(하드코딩). next-intl NS 미사용(공개 문서).
 */

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PRIVACY_LOCALE_COOKIE)?.value;
  const lang = resolvePrivacyLang(langParam, cookieLang);
  return {
    title: `${PRIVACY_POLICY[lang].title} | Villa Go`,
    robots: { index: true, follow: true },
  };
}

function Block({ block }: { block: PolicyBlock }) {
  switch (block.type) {
    case "p":
      return <p className="text-[15px] leading-relaxed text-neutral-700">{block.text}</p>;
    case "ul":
      return (
        <ul className="flex flex-col gap-1.5 pl-1">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-2 text-[15px] leading-relaxed text-neutral-700">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      );
    case "dl":
      return (
        <dl className="flex flex-col gap-3">
          {block.rows.map((row, i) => (
            <div
              key={i}
              className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3"
            >
              <dt className="text-[13px] font-semibold text-neutral-900">{row.term}</dt>
              <dd className="mt-1 text-[14px] leading-relaxed text-neutral-600">{row.desc}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang: langParam } = await searchParams;
  const cookieLang = (await cookies()).get(PRIVACY_LOCALE_COOKIE)?.value;
  const lang = resolvePrivacyLang(langParam, cookieLang);
  const t = PRIVACY_POLICY[lang];

  return (
    <div lang={lang} className="min-h-[100dvh] bg-white text-neutral-900">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-1.5" aria-label="Villa Go">
            <VillaGoMark className="h-5 w-auto" />
            <VillaGoWordmark villa="text-neutral-900" go="text-teal-600" />
          </Link>
          {/* 언어 전환 */}
          <nav aria-label={t.langLabel} className="flex items-center gap-1">
            {PRIVACY_LANGS.map((l) => {
              const active = l === lang;
              return (
                <Link
                  key={l}
                  href={`/privacy?lang=${l}`}
                  aria-current={active ? "true" : undefined}
                  className={
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors " +
                    (active
                      ? "bg-teal-600 text-white"
                      : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800")
                  }
                >
                  {PRIVACY_LANG_NATIVE[l]}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* 본문 */}
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t.title}</h1>
        <p className="mt-2 text-sm text-neutral-500">
          {t.effectiveLabel}: {PRIVACY_EFFECTIVE_DATE}
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {t.intro.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-10">
          {t.sections.map((sec) => (
            <section key={sec.id} aria-labelledby={`sec-${sec.id}`} className="flex flex-col gap-3">
              <h2
                id={`sec-${sec.id}`}
                className="text-lg font-semibold text-neutral-900"
              >
                {sec.title}
              </h2>
              {sec.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </section>
          ))}
        </div>

        {/* 하단 고지 */}
        <p className="mt-12 rounded-xl bg-neutral-50 px-4 py-3 text-[13px] leading-relaxed text-neutral-500">
          {t.disclaimer}
        </p>

        <footer className="mt-8 border-t border-neutral-200 pt-6 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <VillaGoMark className="h-4 w-auto" />
            <VillaGoWordmark villa="text-neutral-700" go="text-teal-600" />
          </div>
          <p className="mt-2 text-xs text-neutral-400">© 2026 Villa Go</p>
        </footer>
      </main>
    </div>
  );
}
