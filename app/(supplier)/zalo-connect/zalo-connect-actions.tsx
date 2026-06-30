"use client";

// /zalo-connect 액션부 (a0 Primary Action + QR + 스킵) — 클라이언트(딥링크/라우팅)
import { useRouter } from "next/navigation";

export function ZaloConnectActions({
  oaUrl,
  connected,
  addFriendLabel,
  oaUnavailableLabel,
  qrTitle,
  qrUrl,
  qrPlaceholder,
  skipLabel,
  doneHref = "/my-villas",
}: {
  oaUrl: string | null;
  connected: boolean;
  addFriendLabel?: string;
  oaUnavailableLabel?: string;
  qrTitle?: string;
  qrUrl?: string | null;
  qrPlaceholder?: string;
  skipLabel: string;
  /** 완료/스킵 후 이동 경로 — 공급자=/my-villas, 청소직원=/cleaning(역할별). */
  doneHref?: string;
}) {
  const router = useRouter();

  // 연결 완료 화면: "완료" 버튼만 → doneHref
  if (connected) {
    return (
      <button
        type="button"
        onClick={() => router.push(doneHref)}
        className="w-full h-14 bg-teal-600 hover:opacity-95 active:scale-95 transition-all text-white rounded-xl font-semibold text-lg"
      >
        {skipLabel}
      </button>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {oaUrl ? (
          <a
            href={oaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-14 bg-[#0068FF] shadow-[0_10px_15px_-3px_rgba(0,104,255,0.2)] hover:opacity-95 active:scale-95 transition-all text-white rounded-xl flex items-center justify-center gap-3 font-semibold text-lg px-6"
          >
            <span className="bg-white rounded-full w-8 h-8 flex items-center justify-center">
              <span className="text-[#0068FF] font-black text-xl leading-none">Z</span>
            </span>
            {addFriendLabel}
          </a>
        ) : (
          <>
            <button
              type="button"
              disabled
              className="w-full h-14 bg-neutral-300 text-white rounded-xl flex items-center justify-center gap-3 font-semibold text-lg px-6 cursor-not-allowed"
            >
              <span className="bg-white rounded-full w-8 h-8 flex items-center justify-center">
                <span className="text-neutral-400 font-black text-xl leading-none">Z</span>
              </span>
              {addFriendLabel}
            </button>
            <p className="text-center text-xs text-neutral-400">{oaUnavailableLabel}</p>
          </>
        )}
      </div>

      {/* QR */}
      <div className="mt-8 bg-neutral-50 rounded-2xl p-6 border border-neutral-100 flex flex-col items-center">
        <p className="text-sm font-medium text-neutral-600 mb-4">{qrTitle}</p>
        <div className="w-40 h-40 bg-white p-2 rounded-xl border border-neutral-200 shadow-sm relative overflow-hidden">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Zalo QR" src={qrUrl} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2 text-neutral-300">
              <span className="material-symbols-outlined text-5xl">qr_code_2</span>
              <span className="text-[10px] text-neutral-400 px-2">{qrPlaceholder}</span>
            </div>
          )}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-teal-500" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-teal-500" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-teal-500" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-teal-500" />
        </div>
      </div>

      {/* Skip — Để sau */}
      <div className="mt-10 flex justify-center">
        <button
          type="button"
          onClick={() => router.push(doneHref)}
          className="text-neutral-400 font-medium text-sm hover:text-neutral-600 active:scale-95 transition-all underline underline-offset-4"
        >
          {skipLabel}
        </button>
      </div>
    </>
  );
}
