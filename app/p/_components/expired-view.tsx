import { PublicFooter } from "./public-footer";
import { ShareButton } from "./share-button";

/**
 * c2 변환 — 만료(expired)/마감(closed) 안내. 서버 판정값으로 단일 상태만 렌더 (T5.5).
 * 문의 버튼은 AppSetting(CONTACT_KAKAO_URL·CONTACT_PHONE) 설정 시에만 노출.
 */
export function ExpiredView({
  variant,
  kakaoUrl,
  phone,
}: {
  variant: "expired" | "closed";
  kakaoUrl?: string | null;
  phone?: string | null;
}) {
  const isExpired = variant === "expired";

  return (
    <div className="bg-neutral-50 text-neutral-900 min-h-screen flex flex-col items-center">
      <header className="bg-white border-b border-neutral-100 flex justify-between items-center w-full px-4 h-14 sticky top-0 z-50">
        <span className="text-teal-600 font-bold text-xl">Villa PMS</span>
        <ShareButton title="Villa PMS" />
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
            {isExpired ? "제안이 만료되었습니다" : "이미 마감되었습니다"}
          </h2>
          <p className="text-neutral-500 leading-relaxed mb-10 px-4">
            {isExpired ? (
              <>
                제안 유효기간이 지나 더 이상 열람할 수 없습니다.
                <br />
                담당자에게 새 제안을 요청해 주세요.
              </>
            ) : (
              <>
                선택하신 날짜의 빌라 예약이 마감되었습니다.
                <br />
                다른 날짜로 다시 제안받으실 수 있습니다.
              </>
            )}
          </p>

          <div className="w-full space-y-3">
            {kakaoUrl && (
              <a
                href={kakaoUrl}
                className="w-full h-14 bg-[#FEE500] text-[#3C1E1E] font-bold rounded-xl flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(254,229,0,0.2)] transition-transform active:scale-[0.98]"
              >
                <span className="material-symbols-outlined icon-fill">chat_bubble</span>
                카카오톡으로 문의
              </a>
            )}
            {phone && (
              <a
                href={`tel:${phone}`}
                className="w-full h-14 border border-neutral-200 text-neutral-700 font-semibold rounded-xl flex items-center justify-center gap-2 bg-white hover:bg-neutral-50 transition-colors active:scale-[0.98]"
              >
                <span className="material-symbols-outlined">call</span>
                전화 연결
              </a>
            )}
          </div>
        </section>
      </main>

      <PublicFooter />

      {/* c2 export 장식 블러 블롭 (146~147행) */}
      <div className="fixed top-20 right-[-10%] w-64 h-64 bg-teal-50 rounded-full blur-3xl opacity-50 -z-10" />
      <div className="fixed bottom-40 left-[-10%] w-72 h-72 bg-orange-50 rounded-full blur-3xl opacity-40 -z-10" />
    </div>
  );
}
