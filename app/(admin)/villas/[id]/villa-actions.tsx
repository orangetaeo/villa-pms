"use client";

// 빌라 상태 액션 버튼 (T1.2 — b10 헤더 우측, status별 분기)
// PENDING_REVIEW → 승인·반려(T1.2b) / ACTIVE → 중단 / INACTIVE → 운영 재개
// API: PATCH /api/villas/[id] { action: "APPROVE" | "REJECT" | "DEACTIVATE" | "REACTIVATE", reason? }
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type VillaAction = "APPROVE" | "DEACTIVATE" | "REACTIVATE";

export default function VillaActions({
  villaId,
  status,
}: {
  villaId: string;
  status: string;
}) {
  const t = useTranslations("adminVillas.detail");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // T1.2b 반려 모달 (b10)
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (action: VillaAction) => {
    if (action === "DEACTIVATE" && !window.confirm(t("confirmDeactivate"))) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/villas/${villaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      router.refresh();
    } catch {
      setError(t("actionError"));
    } finally {
      setPending(false);
    }
  };

  const submitReject = async () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/villas/${villaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECT", reason: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setRejectOpen(false);
      router.refresh();
    } catch {
      setError(t("actionError"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-start md:items-end gap-2">
      <div className="flex items-center gap-2">
        {status === "PENDING_REVIEW" && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => setRejectOpen(true)}
              className="px-5 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-bold transition-all whitespace-nowrap"
            >
              {t("reject")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run("APPROVE")}
              className="px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-green-900/20 transition-all whitespace-nowrap"
            >
              {t("approve")}
            </button>
          </>
        )}
        {status === "ACTIVE" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("DEACTIVATE")}
            className="px-5 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-bold transition-all whitespace-nowrap"
          >
            {t("deactivate")}
          </button>
        )}
        {status === "INACTIVE" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("REACTIVATE")}
            className="px-5 py-2.5 rounded-lg bg-admin-primary hover:bg-admin-primary-dark disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-blue-900/20 transition-all whitespace-nowrap"
          >
            {t("reactivate")}
          </button>
        )}
      </div>
      {error && (
        <span role="alert" className="text-xs text-red-400 font-medium">
          {error}
        </span>
      )}

      {/* 반려 모달 (b10 디자인 참고) */}
      {rejectOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-[480px] bg-admin-card border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
            <div className="p-6">
              <div className="mb-6">
                <h4 className="text-xl font-bold text-white mb-1">{t("rejectModal.title")}</h4>
                <p className="text-xs text-slate-400">{t("rejectModal.description")}</p>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-300 mb-2">
                  {t("rejectModal.reason")} <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder={t("rejectModal.placeholder")}
                  className="w-full bg-admin-bg border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                />
                {reason.trim() === "" && (
                  <p className="text-[11px] text-red-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">error</span>
                    {t("rejectModal.reasonRequired")}
                  </p>
                )}
              </div>
              <div className="mt-8 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setRejectOpen(false)}
                  className="px-5 py-2 rounded-lg border border-slate-700 text-slate-300 text-sm font-bold hover:bg-slate-800 transition-colors"
                >
                  {t("rejectModal.cancel")}
                </button>
                <button
                  type="button"
                  disabled={pending || reason.trim() === ""}
                  onClick={submitReject}
                  className="px-5 py-2 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-red-900/20 transition-all"
                >
                  {t("rejectModal.confirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
