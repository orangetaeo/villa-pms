import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

/**
 * 게스트 체크인 토큰 만료/회수 안내 (ADR-0019 S3) — /p ExpiredView(c2) 톤 계승.
 *   재고·마진·예약정보 0 — 안내 문구·문의 버튼만. 만료(EXPIRED)·회수(REVOKED) 공용.
 */
export function GuestExpiredView({
  lang,
  kakaoUrl,
  phone,
}: {
  lang: PublicLang;
  kakaoUrl: string | null;
  phone: string | null;
}) {
  const t = PUBLIC_LABELS[lang].expired;
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="w-full sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-100 flex items-center justify-center h-14 px-4">
        <span className="flex items-center gap-1.5">
          <VillaGoMark className="h-6 w-auto" />
          <VillaGoWordmark className="text-xl" villa="text-slate-900" go="text-teal-600" />
        </span>
      </header>

      <main className="flex-grow flex flex-col items-center justify-center px-8 text-center gap-5 max-w-md mx-auto w-full">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
          <span className="material-symbols-outlined text-3xl">link_off</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">{t.expiredTitle}</h1>
          <div className="text-sm text-slate-500 leading-relaxed">
            {t.expiredBody.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 w-full pt-2">
          {kakaoUrl && (
            <a
              href={kakaoUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full h-12 rounded-xl bg-teal-600 text-white font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]">chat</span>
              {t.contactKakao}
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              className="w-full h-12 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]">call</span>
              {t.contactPhone}
            </a>
          )}
        </div>
      </main>

      <footer className="bg-slate-50 border-t border-slate-100 py-6 flex flex-col items-center gap-2 px-6 text-center">
        <span className="flex items-center gap-1.5 opacity-70">
          <VillaGoMark className="h-4 w-auto" />
          <VillaGoWordmark villa="text-slate-400" go="text-teal-600/70" />
        </span>
      </footer>
    </div>
  );
}
