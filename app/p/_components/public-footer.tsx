import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/** c1/c2 공통 푸터 (#5 5개 언어) — 브랜드명·저작권은 고정, 링크 3종은 언어별. */
export function PublicFooter({ lang }: { lang: PublicLang }) {
  const t = PUBLIC_LABELS[lang].footer;
  return (
    <footer className="w-full px-6 py-12 flex flex-col gap-4 text-center bg-neutral-50 border-t border-neutral-200">
      <div className="font-bold text-neutral-900">Villa PMS Phu Quoc</div>
      <div className="flex justify-center gap-4">
        <a className="text-sm text-neutral-500 hover:text-teal-600 transition-colors" href="#">
          {t.terms}
        </a>
        <a className="text-sm text-neutral-500 hover:text-teal-600 transition-colors" href="#">
          {t.privacy}
        </a>
        <a className="text-sm text-neutral-500 hover:text-teal-600 transition-colors" href="#">
          {t.depositPolicy}
        </a>
      </div>
      <p className="text-sm text-neutral-500">© 2026 Villa PMS Phu Quoc</p>
    </footer>
  );
}
