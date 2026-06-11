"use client";

// 예약 상세 액션 패널 (b11 Action Panel 변환, T2.5)
// HOLD: 입금 확정 / 취소(사유 필수). CONFIRMED: 체크인·노쇼는 Sprint 3 — disabled.
// 전이는 기존 confirm/cancel API만 호출 — 본 컴포넌트는 새 전이 경로를 만들지 않는다.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BookingStatus } from "@prisma/client";

export default function ActionPanel({
  bookingId,
  status,
}: {
  bookingId: string;
  status: BookingStatus;
}) {
  const t = useTranslations("adminBookings.detail.actions");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? data?.error ?? t("error"));
        return;
      }
      setCancelOpen(false);
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  };

  const terminal = status === "CANCELLED" || status === "EXPIRED" || status === "NO_SHOW" || status === "CHECKED_OUT";
  if (terminal) return null;

  return (
    <section className="bg-admin-card p-6 rounded-xl space-y-4 border border-[#334155]">
      {status === "HOLD" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => post(`/api/bookings/${bookingId}/confirm`)}
          className="w-full bg-admin-primary hover:bg-blue-600 text-white font-bold py-3 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? t("confirming") : t("confirm")}
        </button>
      )}
      {status === "CONFIRMED" && (
        <div className="space-y-1">
          <button
            type="button"
            disabled
            title={t("comingT3")}
            className="w-full bg-admin-primary/40 text-white/60 font-bold py-3 rounded-lg cursor-not-allowed"
          >
            {t("checkin")}
          </button>
          <p className="text-center text-[10px] text-[#475569]">{t("comingT3")}</p>
        </div>
      )}
      {status === "CHECKED_IN" && (
        <div className="space-y-1">
          <button
            type="button"
            disabled
            title={t("comingT3")}
            className="w-full bg-admin-primary/40 text-white/60 font-bold py-3 rounded-lg cursor-not-allowed"
          >
            {t("checkout")}
          </button>
          <p className="text-center text-[10px] text-[#475569]">{t("comingT3")}</p>
        </div>
      )}

      {(status === "HOLD" || status === "CONFIRMED") && (
        <div className="space-y-1">
          {cancelOpen ? (
            <div className="space-y-2">
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t("cancelPlaceholder")}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg text-xs p-3 text-white focus:ring-admin-primary h-20 placeholder-[#475569]"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || cancelReason.trim() === ""}
                  onClick={() =>
                    post(`/api/bookings/${bookingId}/cancel`, { cancelReason: cancelReason.trim() })
                  }
                  className="flex-1 border border-red-500/50 hover:bg-red-500/10 text-red-500 font-bold py-2 rounded-lg transition-all disabled:opacity-50"
                >
                  {t("cancelSubmit")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCancelOpen(false)}
                  className="flex-1 bg-[#334155] text-admin-muted font-bold py-2 rounded-lg"
                >
                  {t("cancelBack")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCancelOpen(true)}
                className="w-full border border-red-500/50 hover:bg-red-500/10 text-red-500 font-bold py-3 rounded-lg transition-all disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <p className="text-center text-[10px] text-[#475569]">{t("cancelHint")}</p>
            </>
          )}
        </div>
      )}

      {status === "CONFIRMED" && (
        <button
          type="button"
          disabled
          title={t("comingT3")}
          className="w-full bg-[#334155] text-admin-muted/60 font-bold py-3 rounded-lg cursor-not-allowed"
        >
          {t("noshow")}
        </button>
      )}

      {error && <p className="text-xs text-red-400 text-center">{error}</p>}
    </section>
  );
}
