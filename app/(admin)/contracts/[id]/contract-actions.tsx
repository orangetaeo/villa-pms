"use client";

// 계약 상세 액션 (T-business-contract-esign) — 서명 요청 발송(DRAFT→SENT)·무효화(→VOID).
//   확인 다이얼로그 후 fetch → 성공 시 router.refresh(서버 재조회). 다크 ADMIN.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function ContractActions({
  contractId,
  status,
}: {
  contractId: string;
  status: "DRAFT" | "SENT" | "SIGNED" | "VOID";
}) {
  const t = useTranslations("adminContracts");
  const router = useRouter();
  const [busy, setBusy] = useState<null | "send" | "void">(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "send" | "void") => {
    const confirmMsg = action === "send" ? t("actions.sendConfirm") : t("actions.voidConfirm");
    if (!window.confirm(confirmMsg)) return;
    setError(null);
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/business-contracts/${contractId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      router.refresh();
    } catch {
      setError(action === "send" ? t("actions.sendError") : t("actions.voidError"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {status === "DRAFT" && (
          <button
            type="button"
            onClick={() => run("send")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white transition-all hover:bg-blue-600 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">send</span>
            {busy === "send" ? t("actions.sending") : t("actions.send")}
          </button>
        )}
        {status !== "VOID" && (
          <button
            type="button"
            onClick={() => run("void")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-bold text-red-300 transition-all hover:bg-red-500/10 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">block</span>
            {busy === "void" ? t("actions.voiding") : t("actions.void")}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
