"use client";

import { useState } from "react";

/**
 * 여행사 셀프 투숙객 명단 입력 폼 (안 B) → POST /api/p/[token]/roster
 * 자유 텍스트(대표자 + 동반자). 여권 OCR가 최종 진실원천이므로 준비용 예고.
 */
export function RosterForm({
  token,
  bookingId,
  initialRoster,
}: {
  token: string;
  bookingId: string;
  initialRoster: string | null;
}) {
  const [roster, setRoster] = useState(initialRoster ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async () => {
    setState("saving");
    try {
      const res = await fetch(`/api/p/${token}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, guestRoster: roster }),
      });
      setState(res.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="roster">
          투숙객 명단
        </label>
        <textarea
          id="roster"
          value={roster}
          onChange={(e) => {
            setRoster(e.target.value);
            setState("idle");
          }}
          maxLength={2000}
          rows={5}
          placeholder="실제 투숙하실 분들의 성함을 입력해주세요. 예) 김학태 / 이영희"
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all resize-none"
        />
        <p className="text-xs text-slate-400 mt-1.5">
          체크인 시 여권과 대조하여 임시거주신고에 사용됩니다.
        </p>
      </div>
      <button
        type="button"
        disabled={state === "saving"}
        onClick={save}
        className="w-full h-14 bg-teal-600 text-white font-bold rounded-lg shadow-lg shadow-teal-100 active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        {state === "saving" ? "저장 중…" : "명단 저장하기"}
      </button>
      {state === "saved" && (
        <p className="text-sm text-teal-600 font-semibold text-center">저장되었습니다.</p>
      )}
      {state === "error" && (
        <p className="text-sm text-red-500 text-center">
          저장에 실패했습니다. 잠시 후 다시 시도해주세요.
        </p>
      )}
    </div>
  );
}
