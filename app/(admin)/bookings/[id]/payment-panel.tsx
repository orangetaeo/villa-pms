"use client";

// 결제(실수납) 패널 — 정산 2차 P2-1. ADMIN(canViewFinance) 전용으로만 렌더(page.tsx 게이트).
// 수납 요약(견적/실수납/미수) + 결제 목록(삭제) + 추가 폼. 숙박비 수납만(보증금 분리).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Currency = "KRW" | "VND";
const METHODS = ["KR_BANK_TRANSFER", "VN_BANK_TRANSFER", "CASH"] as const;

export interface SerPayment {
  id: string;
  receivedAt: string;
  method: string;
  currency?: string;
  amount?: string;
  note?: string | null;
}
export interface SerSummary {
  collectedVndEquivalent: string;
  expectedVndEquivalent: string | null;
  outstandingVnd: string | null;
  status: "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID" | "FX_UNKNOWN";
  paymentCount: number;
}

/** 숫자 문자열(소수 없음) 천단위 콤마 */
function groupDigits(s: string): string {
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;
  return (neg ? "-" : "") + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function sym(currency?: string): string {
  return currency === "KRW" ? "원" : currency === "VND" ? "₫" : "";
}

const STATUS_COLOR: Record<SerSummary["status"], string> = {
  UNPAID: "bg-slate-600/30 text-slate-300",
  PARTIAL: "bg-amber-500/20 text-amber-300",
  PAID: "bg-emerald-500/20 text-emerald-300",
  OVERPAID: "bg-sky-500/20 text-sky-300",
  FX_UNKNOWN: "bg-slate-600/30 text-slate-400",
};

export default function PaymentPanel({
  bookingId,
  saleCurrency,
  defaultFx,
  payments,
  summary,
}: {
  bookingId: string;
  saleCurrency: Currency;
  defaultFx: string | null;
  payments: SerPayment[];
  summary: SerSummary;
}) {
  const t = useTranslations("adminBookings.detail.payments");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currency, setCurrency] = useState<Currency>(saleCurrency);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>(
    saleCurrency === "KRW" ? "KR_BANK_TRANSFER" : "VN_BANK_TRANSFER"
  );
  const [receivedAt, setReceivedAt] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [fxRate, setFxRate] = useState(defaultFx ?? "");
  const [note, setNote] = useState("");

  const resetForm = () => {
    setAmount("");
    setNote("");
    setError(null);
  };

  async function submit() {
    setError(null);
    if (!/^\d+$/.test(amount) || amount === "0") {
      setError(t("addError"));
      return;
    }
    if (currency === "KRW" && !fxRate) {
      setError(t("fxRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currency,
          amount,
          method,
          receivedAt,
          ...(currency === "KRW" ? { fxRateToVnd: fxRate } : {}),
          ...(note ? { note } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error === "FX_REQUIRED_FOR_KRW" ? t("fxRequired") : t("addError"));
        return;
      }
      resetForm();
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("addError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/payments/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  const outstanding = summary.outstandingVnd;
  const overpaid = outstanding != null && outstanding.startsWith("-");

  return (
    <section className="bg-admin-card rounded-xl overflow-hidden shadow-sm border border-[#334155]">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="font-bold text-sm text-white">{t("title")}</h2>
        <span
          className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_COLOR[summary.status]}`}
        >
          {t(`statusLabel.${summary.status}`)}
        </span>
      </div>

      {/* 수납 요약 */}
      <div className="px-6 py-4 border-b border-slate-700 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-[11px] text-admin-muted uppercase tracking-wider">{t("summary.expected")}</p>
          <p className="font-semibold text-white tabular-nums">
            {summary.expectedVndEquivalent != null
              ? `${groupDigits(summary.expectedVndEquivalent)}₫`
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-admin-muted uppercase tracking-wider">{t("summary.collected")}</p>
          <p className="font-semibold text-white tabular-nums">
            {groupDigits(summary.collectedVndEquivalent)}₫
          </p>
        </div>
        <div>
          <p className="text-[11px] text-admin-muted uppercase tracking-wider">
            {overpaid ? t("summary.overpaid") : t("summary.outstanding")}
          </p>
          <p
            className={`font-semibold tabular-nums ${
              outstanding == null
                ? "text-admin-muted"
                : overpaid
                  ? "text-sky-300"
                  : outstanding === "0"
                    ? "text-emerald-300"
                    : "text-amber-300"
            }`}
          >
            {outstanding == null
              ? t("summary.fxUnknown")
              : `${groupDigits(overpaid ? outstanding.slice(1) : outstanding)}₫`}
          </p>
        </div>
      </div>

      {/* 결제 목록 */}
      {payments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/40 text-admin-muted text-[11px] font-bold uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3">{t("date")}</th>
                <th className="px-6 py-3">{t("method")}</th>
                <th className="px-6 py-3 text-right">{t("amount")}</th>
                <th className="px-6 py-3">{t("note")}</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-700/30 transition">
                  <td className="px-6 py-4 text-admin-muted whitespace-nowrap">
                    {p.receivedAt.slice(0, 10)}
                  </td>
                  <td className="px-6 py-4 text-white whitespace-nowrap">
                    {t(`methods.${p.method}`)}
                  </td>
                  <td className="px-6 py-4 font-semibold text-white text-right tabular-nums whitespace-nowrap">
                    {p.amount != null ? `${groupDigits(p.amount)}${sym(p.currency)}` : "—"}
                  </td>
                  <td className="px-6 py-4 text-admin-muted">{p.note ?? "—"}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => remove(p.id)}
                      className="text-[12px] text-rose-400 hover:text-rose-300"
                    >
                      {t("delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 추가 폼 */}
      <div className="px-6 py-4">
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            className="text-sm font-semibold text-teal-300 hover:text-teal-200"
          >
            + {t("add")}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-[11px] text-admin-muted mb-1">{t("form.currency")}</span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white"
                >
                  <option value="VND">VND ₫</option>
                  <option value="KRW">KRW 원</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-[11px] text-admin-muted mb-1">{t("form.amount")}</span>
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white tabular-nums"
                />
              </label>
              <label className="text-sm">
                <span className="block text-[11px] text-admin-muted mb-1">{t("form.method")}</span>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`methods.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-[11px] text-admin-muted mb-1">{t("form.receivedAt")}</span>
                <input
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white"
                />
              </label>
              {currency === "KRW" && (
                <label className="text-sm">
                  <span className="block text-[11px] text-admin-muted mb-1">{t("form.fxRate")}</span>
                  <input
                    inputMode="decimal"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value.replace(/[^\d.]/g, ""))}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white tabular-nums"
                  />
                </label>
              )}
              <label className="text-sm col-span-2">
                <span className="block text-[11px] text-admin-muted mb-1">{t("form.note")}</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white"
                />
              </label>
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={submit}
                disabled={busy}
                className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? t("form.saving") : t("form.save")}
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  resetForm();
                }}
                className="px-4 py-1.5 rounded border border-slate-600 text-admin-muted text-sm"
              >
                {t("form.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
