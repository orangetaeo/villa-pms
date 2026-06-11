"use client";

// 내부 메모 (b11 Memo Section 변환, T2.5) — PATCH /api/bookings/[id] (note 전용)
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function MemoBox({
  bookingId,
  initialNote,
}: {
  bookingId: string;
  initialNote: string | null;
}) {
  const t = useTranslations("adminBookings.detail.memo");
  const [note, setNote] = useState(initialNote ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async () => {
    setState("saving");
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      setState(res.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <section className="bg-admin-card p-6 rounded-xl border border-dashed border-slate-700">
      <h2 className="text-xs font-bold text-admin-muted mb-3 uppercase tracking-widest">
        {t("title")}
      </h2>
      <textarea
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
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
