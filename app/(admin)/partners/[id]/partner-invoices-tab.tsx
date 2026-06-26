"use client";

// 파트너 마감 청구서 탭 (PARTNER-3b-UI) — ADMIN(canViewFinance) 전용 페이지에서만 렌더.
// 생성·발행·수납·무효·PDF·Zalo 발송. 한도·마진 미표시(누수 가드).
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatVnd } from "@/lib/format";

interface InvoiceRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  totalVnd: string;
  paidVnd: string;
  status: "DRAFT" | "ISSUED" | "PARTIAL" | "PAID" | "VOID";
  statementUrl: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  _count: { receivables: number };
}

interface PaymentRow {
  id: string;
  amount: string;
  currency: string;
  receivedAt: string;
  method: string;
}

const STATUS_BADGE: Record<InvoiceRow["status"], string> = {
  DRAFT: "bg-slate-700 text-slate-200",
  ISSUED: "bg-sky-500/15 text-sky-300",
  PARTIAL: "bg-amber-500/15 text-amber-300",
  PAID: "bg-emerald-500/15 text-emerald-300",
  VOID: "bg-slate-800 text-slate-500 line-through",
};

const fmtDate = (iso: string) => iso.slice(0, 10);

export default function PartnerInvoicesTab({ partnerId }: { partnerId: string }) {
  const t = useTranslations("adminPartners.invoices");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // 진행 중 메시지
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // 생성 폼
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  // 수납 내역(정정용) — 펼친 청구서 id + 그 결제 목록
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/partners/${partnerId}/invoices`);
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const errMsg = (code: string | undefined) => {
    const known = ["PERIOD_EXISTS", "NO_RECEIVABLES", "NO_ZALO_LINK", "SEND_FAILED", "INVALID_STATUS"];
    return t(`err.${known.includes(code ?? "") ? code : "generic"}`);
  };

  const create = async () => {
    if (!periodStart || !periodEnd) return;
    setBusy(t("creating"));
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/partners/${partnerId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(errMsg(body.error));
        return;
      }
      setPeriodStart("");
      setPeriodEnd("");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const transition = async (id: string, action: "issue" | "void") => {
    if (action === "void" && !window.confirm(t("confirmVoid"))) return;
    setBusy("…");
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/partner-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(errMsg(body.error));
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const pay = async (id: string) => {
    const raw = window.prompt(t("payAmount"));
    if (raw == null) return;
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits) return;
    setBusy("…");
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/partner-invoices/${id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountVnd: digits }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(errMsg(body.error));
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const fetchPayments = useCallback(async (id: string) => {
    const res = await fetch(`/api/partner-invoices/${id}/payments`);
    if (res.ok) {
      const data = await res.json();
      setPayments(data.payments ?? []);
    } else {
      setPayments([]);
    }
  }, []);

  const togglePayments = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setPayments([]);
      return;
    }
    setExpanded(id);
    await fetchPayments(id);
  };

  // 수납 정정(취소) — Payment 삭제 + 역분개 + paidVnd 차감 (ADR-0027 D3)
  const reverse = async (invId: string, paymentId: string) => {
    if (!window.confirm(t("confirmReverse"))) return;
    setBusy("…");
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/partner-invoices/${invId}/payments/${paymentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(errMsg(body.error));
        return;
      }
      setFeedback(t("reverseDone"));
      await Promise.all([load(), fetchPayments(invId)]);
    } finally {
      setBusy(null);
    }
  };

  const openPdf = async (id: string) => {
    setBusy(t("generating"));
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/partner-invoices/${id}/statement`, { method: "POST" });
      if (!res.ok) {
        setError(errMsg(undefined));
        return;
      }
      window.open(`/api/partner-invoices/${id}/statement`, "_blank", "noopener");
    } finally {
      setBusy(null);
    }
  };

  const sendZalo = async (id: string) => {
    setBusy(t("sending"));
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/partner-invoices/${id}/send`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errMsg(body.error));
        return;
      }
      setFeedback(body.withAttachment ? t("sentWithFile") : t("sentTextOnly"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-admin-muted">{t("hint")}</p>

      {/* 생성 폼 */}
      <div className="rounded-xl border border-slate-800 bg-admin-card p-4">
        <h3 className="mb-3 text-xs font-bold uppercase text-slate-500">{t("createTitle")}</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t("periodStart")}
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            {t("periodEnd")}
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </label>
          <button
            type="button"
            onClick={create}
            disabled={!!busy || !periodStart || !periodEnd}
            className="rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy === t("creating") ? t("creating") : t("generate")}
          </button>
        </div>
      </div>

      {(error || feedback || busy) && (
        <div
          className={`rounded-lg px-4 py-2 text-sm ${
            error
              ? "bg-red-500/10 text-red-300"
              : feedback
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-slate-800 text-slate-300"
          }`}
        >
          {error ?? feedback ?? busy}
        </div>
      )}

      {/* 청구서 목록 */}
      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">…</p>
      ) : invoices.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {invoices.map((inv) => {
            const outstanding = BigInt(inv.totalVnd) - BigInt(inv.paidVnd);
            const canIssue = inv.status === "DRAFT";
            const canVoid = inv.status !== "PAID" && inv.status !== "VOID";
            const canPay = inv.status === "ISSUED" || inv.status === "PARTIAL";
            const canSend = inv.status !== "DRAFT" && inv.status !== "VOID";
            return (
              <li key={inv.id} className="rounded-xl border border-slate-800 bg-admin-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[inv.status]}`}
                      >
                        {t(`invoiceStatus.${inv.status}`)}
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {fmtDate(inv.periodStart)} ~ {fmtDate(inv.periodEnd)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("due")}: <span className="text-slate-300">{fmtDate(inv.dueDate)}</span> ·{" "}
                      {t("count", { n: inv._count.receivables })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-black tabular-nums text-white">{formatVnd(inv.totalVnd)}</p>
                    {BigInt(inv.paidVnd) > 0n && (
                      <p className="text-xs tabular-nums text-slate-400">
                        {t("paid")}: {formatVnd(inv.paidVnd)}
                        {outstanding > 0n && <span className="text-amber-400"> · {formatVnd(outstanding.toString())}</span>}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {canIssue && (
                    <ActionBtn onClick={() => transition(inv.id, "issue")} disabled={!!busy}>
                      {t("action.issue")}
                    </ActionBtn>
                  )}
                  {canPay && (
                    <ActionBtn onClick={() => pay(inv.id)} disabled={!!busy}>
                      {t("action.pay")}
                    </ActionBtn>
                  )}
                  <ActionBtn onClick={() => openPdf(inv.id)} disabled={!!busy}>
                    {t("action.pdf")}
                  </ActionBtn>
                  {canSend && (
                    <ActionBtn onClick={() => sendZalo(inv.id)} disabled={!!busy} primary>
                      {t("action.zalo")}
                    </ActionBtn>
                  )}
                  {canVoid && (
                    <ActionBtn onClick={() => transition(inv.id, "void")} disabled={!!busy} danger>
                      {t("action.void")}
                    </ActionBtn>
                  )}
                  {BigInt(inv.paidVnd) > 0n && (
                    <ActionBtn onClick={() => togglePayments(inv.id)} disabled={!!busy}>
                      {expanded === inv.id ? t("action.hidePayments") : t("action.payments")}
                    </ActionBtn>
                  )}
                </div>

                {expanded === inv.id && (
                  <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                    <h4 className="mb-2 text-[11px] font-bold uppercase text-slate-500">
                      {t("paymentsTitle")}
                    </h4>
                    {payments.length === 0 ? (
                      <p className="text-xs text-slate-500">{t("noPayments")}</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {payments.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-slate-300">
                              <span className="tabular-nums">{fmtDate(p.receivedAt)}</span> ·{" "}
                              <span className="font-semibold tabular-nums text-white">
                                {formatVnd(p.amount)}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => reverse(inv.id, p.id)}
                              disabled={!!busy}
                              className="rounded border border-red-900 px-2 py-0.5 text-[11px] font-bold text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                            >
                              {t("action.reverse")}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  primary,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const cls = primary
    ? "bg-admin-primary text-white"
    : danger
      ? "border border-red-900 text-red-300 hover:bg-red-950/40"
      : "border border-slate-700 text-slate-200 hover:bg-slate-800";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
