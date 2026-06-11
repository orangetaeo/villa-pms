"use client";

// 빌라 상태 액션 버튼 (T1.2 — b10 헤더 우측, status별 분기)
// PENDING_REVIEW → 승인 / ACTIVE → 중단 / INACTIVE → 운영 재개
// API: PATCH /api/villas/[id] { action: "APPROVE" | "DEACTIVATE" | "REACTIVATE" }
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

  return (
    <div className="flex flex-col items-start md:items-end gap-2">
      <div className="flex items-center gap-2">
        {status === "PENDING_REVIEW" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("APPROVE")}
            className="px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-green-900/20 transition-all whitespace-nowrap"
          >
            {t("approve")}
          </button>
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
    </div>
  );
}
