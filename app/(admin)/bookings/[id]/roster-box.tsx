"use client";

// 실제 투숙객 명단 (T-guest-roster) — PATCH /api/bookings/[id] (guestRoster 전용)
// 여행사 채널은 가예약 식별명과 실제 투숙객이 다를 수 있어, 입금 확정~체크인 전날 ADMIN이 실명을 입력한다.
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function RosterBox({
  bookingId,
  initialRoster,
  showReminder,
}: {
  bookingId: string;
  initialRoster: string | null;
  /** CONFIRMED 이상인데 명단이 비어 있으면 입력 유도 힌트 표시 */
  showReminder: boolean;
}) {
  const t = useTranslations("adminBookings.detail.roster");
  const [roster, setRoster] = useState(initialRoster ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async () => {
    setState("saving");
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestRoster: roster }),
      });
      setState(res.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="bg-admin-card p-6 rounded-xl border border-slate-700">
      <h2 className="text-xs font-bold text-admin-muted mb-1 uppercase tracking-widest">
        {t("title")}
      </h2>
      <p className="text-[11px] text-[#475569] mb-3">{t("hint")}</p>
      {showReminder && state === "idle" && roster.trim() === "" && (
        <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold text-amber-500">
          <span className="material-symbols-outlined text-sm">info</span>
          {t("reminder")}
        </div>
      )}
      <textarea
        value={roster}
        onChange={(e) => {
          setRoster(e.target.value);
          setState("idle");
        }}
        maxLength={2000}
        placeholder={t("placeholder")}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg text-xs p-3 text-white focus:ring-admin-primary h-24 placeholder-[#475569]"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={state === "saving"}
          onClick={save}
          className="text-[10px] font-bold text-admin-primary hover:underline disabled:opacity-50"
        >
          {state === "saving" ? t("saving") : t("save")}
        </button>
        {state === "saved" && <span className="text-[10px] text-green-500">{t("saved")}</span>}
        {state === "error" && <span className="text-[10px] text-red-400">{t("error")}</span>}
      </div>
    </section>
  );
}
