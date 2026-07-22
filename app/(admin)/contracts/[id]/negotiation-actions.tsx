"use client";

// 계약 협의 해소 액션 (T-contract-negotiation S2) — 다크 ADMIN.
//   수용: 역제안 단계표가 있으면 그 값을 계약 termsJson에 반영해서 보낸다(서버가 다시 전량 검증).
//   거절: 사유 필수 — 상대방 화면·Zalo에 그대로 노출된다.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cancelTierPeriodLabel, type CancelTier } from "@/lib/cancel-tiers";

export interface AdminNegotiation {
  id: string;
  clauseKey: string;
  reason: string;
  status: string;
  note: string | null;
  resolvedNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  proposedTiers: CancelTier[] | null;
}

export default function NegotiationActions({
  contractId,
  negotiation,
  currentTerms,
}: {
  contractId: string;
  negotiation: AdminNegotiation;
  /** 계약의 현재 termsJson — 수용 시 역제안만 갈아끼워 전체를 다시 보낸다(서버 .strict 검증 통과용). */
  currentTerms: Record<string, unknown> | null;
}) {
  const t = useTranslations("adminContracts");
  const router = useRouter();
  const [busy, setBusy] = useState<null | "ACCEPT" | "REJECT">(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const applyTiers = negotiation.proposedTiers !== null && currentTerms !== null;

  const run = async (action: "ACCEPT" | "REJECT") => {
    setError(null);
    if (action === "REJECT" && !note.trim()) {
      setError(t("negotiation.rejectNoteRequired"));
      return;
    }
    if (!window.confirm(action === "ACCEPT" ? t("negotiation.acceptConfirm") : t("negotiation.rejectConfirm"))) {
      return;
    }
    setBusy(action);
    try {
      const res = await fetch(
        `/api/admin/business-contracts/${contractId}/negotiations/${negotiation.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ...(action === "ACCEPT" && applyTiers
              ? { terms: { ...currentTerms, cancelTiers: negotiation.proposedTiers } }
              : {}),
            ...(note.trim() ? { resolvedNote: note.trim() } : {}),
          }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error === "TERMS_VALIDATION_FAILED"
            ? t("negotiation.termsInvalid")
            : t("negotiation.error"),
        );
        return;
      }
      router.refresh();
    } catch {
      setError(t("negotiation.error"));
    } finally {
      setBusy(null);
    }
  };

  if (negotiation.status !== "OPEN") {
    return (
      <p className="text-xs text-slate-500">
        {t(`negotiation.status.${negotiation.status}`)}
        {negotiation.resolvedNote ? ` — ${negotiation.resolvedNote}` : ""}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {negotiation.proposedTiers && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <p className="mb-1.5 text-xs font-bold text-slate-400">{t("negotiation.proposal")}</p>
          <ul className="space-y-0.5 text-xs text-slate-300">
            {negotiation.proposedTiers.map((row, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{cancelTierPeriodLabel(negotiation.proposedTiers ?? [], i, "ko")}</span>
                <span className="tabular-nums">
                  {t("negotiation.proposalRow", {
                    refund: row.guestRefundPct,
                    pay: row.supplierPayPct,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={t("negotiation.notePlaceholder")}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run("ACCEPT")}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-emerald-500 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">check</span>
          {busy === "ACCEPT" ? t("negotiation.working") : t("negotiation.accept")}
        </button>
        <button
          type="button"
          onClick={() => run("REJECT")}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-bold text-red-300 transition-all hover:bg-red-500/10 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">close</span>
          {busy === "REJECT" ? t("negotiation.working") : t("negotiation.reject")}
        </button>
      </div>

      {applyTiers && <p className="text-xs text-slate-500">{t("negotiation.acceptApplies")}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
