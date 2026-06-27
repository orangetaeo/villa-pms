"use client";

import { useState } from "react";
import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/**
 * 게스트 입금통보 영역 (B1) → POST /api/p/[token]/payment-notice
 * HOLD 상태에서만 done 페이지가 렌더한다. 입금자명(선택) + "입금했습니다" 버튼.
 * 성공 시 disabled 완료 상태로 전환(중복 통보 방지).
 */
export function PaymentNoticeButton({
  token,
  bookingId,
  lang,
}: {
  token: string;
  bookingId: string;
  lang: PublicLang;
}) {
  const t = PUBLIC_LABELS[lang].donePage;
  const [depositorName, setDepositorName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  const notify = async () => {
    setState("sending");
    try {
      const res = await fetch(`/api/p/${token}/payment-notice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          depositorName: depositorName.trim() || undefined,
        }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  const done = state === "done";

  return (
    <div className="bg-white rounded-2xl shadow-xl shadow-slate-100/50 border border-gray-100 p-6 space-y-4">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-teal-600 mt-0.5">receipt_long</span>
        <div className="space-y-1">
          <h4 className="text-base font-bold text-slate-900">{t.paymentNoticeTitle}</h4>
          <p className="text-xs text-slate-500 leading-relaxed">{t.paymentNoticeDesc}</p>
        </div>
      </div>

      {done ? (
        <div className="flex items-center justify-center gap-2 h-14 bg-teal-50 text-teal-700 font-bold rounded-lg">
          <span className="material-symbols-outlined">check_circle</span>
          {t.paymentNoticeDone}
        </div>
      ) : (
        <>
          <div>
            <label
              className="block text-sm font-semibold text-slate-700 mb-1.5"
              htmlFor="depositorName"
            >
              {t.depositorNameLabel}
            </label>
            <input
              id="depositorName"
              type="text"
              value={depositorName}
              onChange={(e) => {
                setDepositorName(e.target.value);
                if (state === "error") setState("idle");
              }}
              maxLength={100}
              placeholder={t.depositorNamePlaceholder}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all"
            />
          </div>
          <button
            type="button"
            disabled={state === "sending"}
            onClick={notify}
            className="w-full h-14 bg-teal-600 text-white font-bold rounded-lg shadow-lg shadow-teal-100 active:scale-[0.98] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-xl">send</span>
            {state === "sending" ? t.paymentNoticeSending : t.paymentNoticeCta}
          </button>
          {state === "error" && (
            <p className="text-sm text-red-500 text-center">{t.paymentNoticeError}</p>
          )}
        </>
      )}
    </div>
  );
}
