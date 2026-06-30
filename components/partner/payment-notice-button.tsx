"use client";

// 파트너 입금 통보 버튼 (여행사 포털 B) — 청구서/채권에 "입금했습니다" 신호.
//   ★ 상태 미변경 — 운영자 수동 확정 대조용. 금액·입금자명은 선택(자진 신고).
//   라이트 테마(파트너 포털). i18n: partner.paymentNotice.*
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function PaymentNoticeButton({
  invoiceId,
  receivableId,
}: {
  invoiceId?: string;
  receivableId?: string;
}) {
  const t = useTranslations("partner.paymentNotice");

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const [amount, setAmount] = useState("");
  const [depositor, setDepositor] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      // 금액 입력값에서 숫자만 추출(점·콤마 제거) — 빈 값이면 미전송(전액 통보).
      const digits = amount.replace(/\D/gu, "");
      const res = await fetch("/api/partner/receivables/payment-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(invoiceId ? { invoiceId } : {}),
          ...(receivableId ? { receivableId } : {}),
          ...(digits ? { amountVnd: digits } : {}),
          ...(depositor.trim() ? { depositorName: depositor.trim() } : {}),
        }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      setDone(true);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700">
        <span className="material-symbols-outlined text-base">check_circle</span>
        {t("done")}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 transition-colors hover:bg-teal-100 active:scale-95"
      >
        <span className="material-symbols-outlined text-base">payments</span>
        {t("button")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-1 space-y-2 rounded-xl bg-neutral-50 p-3">
      <p className="text-xs font-medium text-neutral-500">{t("hint")}</p>
      <input
        type="text"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={t("amountPlaceholder")}
        className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-teal-500"
      />
      <input
        type="text"
        value={depositor}
        onChange={(e) => setDepositor(e.target.value)}
        placeholder={t("depositorPlaceholder")}
        className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-teal-500"
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600">
          {t("error")}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
        >
          {busy ? t("submitting") : t("submit")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-500"
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
