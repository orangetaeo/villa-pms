"use client";

// 원천 공급자 본인 지급 정보 자기관리 폼 (ADR-0023 S2) — 은행명·계좌번호·예금주·연락처.
//   GET /api/vendor/profile 로 본인 값 로드 → PATCH 로 저장(phone·bankInfo만).
//   ★ 누수: 본인 지급 계좌이므로 본인 노출 OK. 우리 판매가·마진과 무관(API가 vendorId 스코프 강제).
//   라이트 테마(vi 기본·모바일) — ChangePasswordForm supplier variant 토큰과 동일 스타일.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type ProfileResponse = {
  name: string;
  nameKo: string | null;
  phone: string | null;
  bankInfo: { bankName: string | null; accountNumber: string | null; accountHolder: string | null } | null;
};

const inputClass =
  "h-12 w-full bg-white border border-neutral-200 rounded-xl px-4 text-base text-neutral-900 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none";
const labelClass = "text-sm font-semibold text-neutral-700";

export default function VendorPayoutForm() {
  const t = useTranslations("vendor");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // 읽기전용 표시(운영자 관리 필드)
  const [name, setName] = useState("");
  // 편집 가능 필드
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/vendor/profile", { cache: "no-store" });
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json()) as ProfileResponse;
        if (!active) return;
        setName(data.name ?? "");
        setPhone(data.phone ?? "");
        setBankName(data.bankInfo?.bankName ?? "");
        setAccountNumber(data.bankInfo?.accountNumber ?? "");
        setAccountHolder(data.bankInfo?.accountHolder ?? "");
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim() || null,
          bankInfo: {
            bankName: bankName.trim() || null,
            accountNumber: accountNumber.trim() || null,
            accountHolder: accountHolder.trim() || null,
          },
        }),
      });
      if (!res.ok) {
        setMessage({ tone: "error", text: t("payout.saveError") });
        return;
      }
      setMessage({ tone: "ok", text: t("payout.saveOk") });
    } catch {
      setMessage({ tone: "error", text: t("payout.saveError") });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="py-6 text-center text-sm text-neutral-400">{t("loading")}</p>;
  }
  if (loadError) {
    return <p className="py-6 text-center text-sm text-rose-600">{t("loadError")}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* 거래처명 — 읽기전용(운영자 관리) */}
      {name && (
        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>{t("payout.name")}</span>
          <p className="rounded-xl bg-neutral-50 px-4 py-3 text-base font-medium text-neutral-700">
            {name}
          </p>
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("payout.phone")}</span>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t("payout.phonePlaceholder")}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("payout.bankName")}</span>
        <input
          type="text"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          placeholder={t("payout.bankNamePlaceholder")}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("payout.accountNumber")}</span>
        <input
          type="text"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          placeholder={t("payout.accountNumberPlaceholder")}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("payout.accountHolder")}</span>
        <input
          type="text"
          value={accountHolder}
          onChange={(e) => setAccountHolder(e.target.value)}
          placeholder={t("payout.accountHolderPlaceholder")}
          className={inputClass}
        />
      </label>

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`text-xs font-medium ${message.tone === "ok" ? "text-teal-700" : "text-rose-600"}`}
        >
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-teal-600 px-4 py-3.5 text-base font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
      >
        {busy ? t("submitting") : t("payout.save")}
      </button>
    </form>
  );
}
