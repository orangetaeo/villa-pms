"use client";

// 파트너 본인 연락처 자기관리 폼 (여행사 포털 C) — 전화·이메일.
//   GET /api/partner/profile 로 본인 값 로드 → PATCH 로 저장(contactPhone·contactEmail만).
//   ★ 누수: 본인 연락처만. 신용한도·마진·KRW 무관(API가 partnerId 스코프 강제).
//   라이트 테마(파트너 포털) — VendorPayoutForm 토큰과 동일 스타일.
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type ProfileResponse = {
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
};

const inputClass =
  "h-12 w-full bg-white border border-neutral-200 rounded-xl px-4 text-base text-neutral-900 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none";
const labelClass = "text-sm font-semibold text-neutral-700";

export default function PartnerContactForm() {
  const t = useTranslations("partner.contact");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/partner/profile", { cache: "no-store" });
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json()) as ProfileResponse;
        if (!active) return;
        setName(data.name ?? "");
        setPhone(data.contactPhone ?? "");
        setEmail(data.contactEmail ?? "");
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
      const res = await fetch("/api/partner/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactPhone: phone.trim() || null,
          contactEmail: email.trim() || null,
        }),
      });
      if (!res.ok) {
        setMessage({ tone: "error", text: t("saveError") });
        return;
      }
      setMessage({ tone: "ok", text: t("saveOk") });
    } catch {
      setMessage({ tone: "error", text: t("saveError") });
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
          <span className={labelClass}>{t("name")}</span>
          <p className="rounded-xl bg-neutral-50 px-4 py-3 text-base font-medium text-neutral-700">
            {name}
          </p>
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("phone")}</span>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t("phonePlaceholder")}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("email")}</span>
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
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
        {busy ? t("saving") : t("save")}
      </button>
    </form>
  );
}
