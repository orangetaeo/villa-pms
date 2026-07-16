import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

/** c1/c2 공통 푸터 (#5 5개 언어) — 브랜드명·저작권은 고정, 링크 3종은 언어별. */
export function PublicFooter({ lang }: { lang: PublicLang }) {
  const t = PUBLIC_LABELS[lang].footer;
  // /privacy는 ko/en/vi 3언어만 지원 — ru/zh 방문자는 en으로 안내(ko 폴백보다 가독성 우선).
  const privacyLang = lang === "ko" || lang === "vi" ? lang : "en";
  return (
    <footer className="w-full px-6 py-12 flex flex-col gap-4 text-center bg-neutral-50 border-t border-neutral-200">
      <div className="flex items-center justify-center gap-1.5">
        <VillaGoMark className="h-5 w-auto" />
        <VillaGoWordmark villa="text-neutral-900" go="text-teal-600" />
      </div>
      <div className="flex justify-center gap-4">
        <a className="text-sm text-neutral-500 hover:text-teal-600 transition-colors" href="#">
          {t.terms}
        </a>
        <a
          className="text-sm text-neutral-500 hover:text-teal-600 transition-colors"
          href={`/privacy?lang=${privacyLang}`}
        >
          {t.privacy}
        </a>
        <a className="text-sm text-neutral-500 hover:text-teal-600 transition-colors" href="#">
          {t.depositPolicy}
        </a>
      </div>
      <p className="text-sm text-neutral-500">© 2026 Villa Go</p>
    </footer>
  );
}
