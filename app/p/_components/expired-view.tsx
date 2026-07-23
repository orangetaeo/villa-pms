import { PublicFooter } from "./public-footer";
import { ShareButton } from "./share-button";
import { LangSelector } from "./lang-selector";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/**
 * c2 변환 (#5 5개 언어) — 만료(expired)/마감(closed) 안내. 서버 판정값으로 단일 상태만 렌더 (T5.5).
 * 문의 버튼은 AppSetting(CONTACT_KAKAO_URL·CONTACT_PHONE) 설정 시에만 노출.
 */
export function ExpiredView({
  variant,
  kakaoUrl,
  phone,
  lang,
}: {
  variant: "expired" | "closed";
  kakaoUrl?: string | null;
  phone?: string | null;
  lang: PublicLang;
}) {
  const t = PUBLIC_LABELS[lang].expired;
  const isExpired = variant === "expired";

  return (
    <div className="bg-neutral-50 text-neutral-900 min-h-screen flex flex-col items-center">
      <header className="bg-white border-b border-neutral-100 flex justify-between items-center w-full px-4 h-14 sticky top-0 z-50">
        {/* 로고 좌측 정렬 — 정중앙 absolute 는 좁은 폰에서 우측 컨트롤과 겹치고, 가운데 정렬은 어중간(2026-07-24) */}
        <span className="flex min-w-0 flex-1 items-center justify-start gap-1.5 overflow-hidden pr-1">
          <VillaGoMark className="h-6 w-auto shrink-0" />
          <VillaGoWordmark className="truncate text-lg sm:text-xl" villa="text-slate-900" go="text-teal-600" />
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <LangSelector current={lang} />
          <ShareButton title="Villa Go" lang={lang} />
        </div>
      </header>

      <main className="w-full max-w-md px-6 py-12 flex-grow flex flex-col justify-center">
        <section className="flex flex-col items-center text-center">
          {isExpired ? (
            <div className="relative mb-8">
              <div className="w-24 h-24 bg-neutral-100 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-neutral-400 text-5xl">history</span>
              </div>
              <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full border border-neutral-100">
                <span className="material-symbols-outlined text-neutral-400 text-xl">timer_off</span>
              </div>
            </div>
          ) : (
            <div className="relative mb-8">
              <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-red-400 text-5xl">calendar_month</span>
              </div>
              <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full border border-red-50">
                <span className="material-symbols-outlined icon-fill text-red-500 text-xl">cancel</span>
              </div>
            </div>
          )}

          <h2 className="text-2xl font-semibold text-neutral-900 mb-4 tracking-tight">
            {isExpired ? t.expiredTitle : t.closedTitle}
          </h2>
          <p className="text-neutral-500 leading-relaxed mb-10 px-4">
            {(isExpired ? t.expiredBody : t.closedBody).map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </p>

          <div className="w-full space-y-3">
            {kakaoUrl && (
              <a
                href={kakaoUrl}
                className="w-full h-14 bg-[#FEE500] text-[#3C1E1E] font-bold rounded-xl flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(254,229,0,0.2)] transition-transform active:scale-[0.98]"
              >
                <span className="material-symbols-outlined icon-fill">chat_bubble</span>
                {t.contactKakao}
              </a>
            )}
            {phone && (
              <a
                href={`tel:${phone}`}
                className="w-full h-14 border border-neutral-200 text-neutral-700 font-semibold rounded-xl flex items-center justify-center gap-2 bg-white hover:bg-neutral-50 transition-colors active:scale-[0.98]"
              >
                <span className="material-symbols-outlined">call</span>
                {t.contactPhone}
              </a>
            )}
          </div>
        </section>
      </main>

      <PublicFooter lang={lang} />

      {/* c2 export 장식 블러 블롭 (146~147행) */}
      <div className="fixed top-20 right-[-10%] w-64 h-64 bg-teal-50 rounded-full blur-3xl opacity-50 -z-10" />
      <div className="fixed bottom-40 left-[-10%] w-72 h-72 bg-orange-50 rounded-full blur-3xl opacity-40 -z-10" />
    </div>
  );
}
