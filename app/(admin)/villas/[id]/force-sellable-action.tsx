"use client";

// 강제 판매가능 버튼 (T3.4 — ADR-0012 검수 게이트 ADMIN 오버라이드)
// status === "ACTIVE" && !isSellable 일 때만 노출. 확인 모달 → POST 강제 전환.
// API: POST /api/villas/[id]/force-sellable { reason? }
//   성공 { isSellable: true, gateAlreadyOpen, resolvedTaskCount, openCheckoutWarning }
//   409 INVALID_STATUS / 403 FORBIDDEN / 404 NOT_FOUND / 네트워크 실패 처리
// 응답은 마진·판매가 미포함(사업 핵심 원칙2). 모달 패턴은 villa-actions 반려 모달 재사용.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Feedback = { kind: "success" | "warning" | "error"; message: string } | null;

export default function ForceSellableAction({ villaId }: { villaId: string }) {
  const t = useTranslations("adminVillas.detail");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const submit = async () => {
    setPending(true);
    setFeedback(null);
    try {
      const trimmed = reason.trim();
      const res = await fetch(`/api/villas/${villaId}/force-sellable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed ? { reason: trimmed } : {}),
      });

      if (!res.ok) {
        if (res.status === 409) {
          setFeedback({ kind: "error", message: t("forceInvalidStatus") });
        } else if (res.status === 403) {
          setFeedback({ kind: "error", message: t("forceForbidden") });
        } else {
          setFeedback({ kind: "error", message: t("forceError") });
        }
        return;
      }

      const data = (await res.json()) as {
        isSellable: boolean;
        gateAlreadyOpen: boolean;
        openCheckoutWarning: boolean;
      };

      setOpen(false);
      setReason("");

      // 미결 체크아웃 청소 경고 > 이미 판매가능 안내 > 일반 성공
      if (data.openCheckoutWarning) {
        setFeedback({ kind: "warning", message: t("forceCheckoutWarning") });
      } else if (data.gateAlreadyOpen) {
        setFeedback({ kind: "warning", message: t("forceAlreadyOpen") });
      } else {
        setFeedback({ kind: "success", message: t("forceSuccess") });
      }

      router.refresh();
    } catch {
      setFeedback({ kind: "error", message: t("forceError") });
    } finally {
      setPending(false);
    }
  };

  const feedbackColor =
    feedback?.kind === "success"
      ? "text-green-400"
      : feedback?.kind === "warning"
        ? "text-amber-400"
        : "text-red-400";

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setFeedback(null);
          setOpen(true);
        }}
        className="px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-amber-900/20 transition-all whitespace-nowrap flex items-center gap-1.5"
      >
        <span className="material-symbols-outlined text-base">bolt</span>
        {t("forceSellable")}
      </button>

      {feedback && (
        <span role="alert" className={`text-xs font-medium ${feedbackColor}`}>
          {feedback.message}
        </span>
      )}

      {/* 확인 모달 — 검수 생략 경고 + 선택 사유 (villa-actions 반려 모달 패턴) */}
      {open && (
        <div
          onClick={() => {
            if (!pending) setOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] bg-admin-card border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="p-6">
              <div className="mb-5">
                <h4 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-500">bolt</span>
                  {t("forceModal.title")}
                </h4>
              </div>

              {/* 검수 생략 경고 박스 */}
              <div className="mb-5 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-sm font-bold text-amber-400 flex items-start gap-2">
                  <span className="material-symbols-outlined text-base shrink-0">warning</span>
                  <span>{t("forceModal.warning")}</span>
                </p>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                  {t("forceModal.description")}
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-300 mb-2">
                  {t("forceModal.reasonLabel")}
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={t("forceModal.reasonPlaceholder")}
                  className="w-full bg-admin-bg border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                />
              </div>

              {feedback?.kind === "error" && (
                <p role="alert" className="mt-3 text-[11px] text-red-400 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">error</span>
                  {feedback.message}
                </p>
              )}

              <div className="mt-8 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                  className="px-5 py-2 rounded-lg border border-slate-700 text-slate-300 text-sm font-bold hover:bg-slate-800 transition-colors"
                >
                  {t("forceModal.cancel")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={submit}
                  className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-amber-900/20 transition-all"
                >
                  {t("forceModal.confirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
