"use client";

// 게스트 셀프 체크인 링크 카드 (ADR-0019 S3, 운영자 다크 톤) — 예약 상세 우측.
//   발급/재발급(POST) · 회수(DELETE) · 링크 복사. QR 라이브러리 미설치 → 링크+복사만.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export interface GuestTokenState {
  token: string;
  url: string; // /g/<token>
  expiresAt: string; // ISO
  revoked: boolean;
  signedAt: string | null; // 게스트가 셀프 서명한 시각
}

export default function GuestTokenCard({
  bookingId,
  initial,
  origin,
}: {
  bookingId: string;
  initial: GuestTokenState | null;
  origin: string; // 절대 링크 구성용(빈 문자열이면 상대 경로 복사)
}) {
  const t = useTranslations("adminGuestToken");
  const router = useRouter();
  const [state, setState] = useState<GuestTokenState | null>(initial);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = state != null && !state.revoked;
  const fullUrl = state ? `${origin}${state.url}` : "";

  const issue = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/guest-token`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      setState({
        token: data.token,
        url: data.url,
        expiresAt: data.expiresAt,
        revoked: false,
        signedAt: state?.signedAt ?? null,
      });
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (busy || !state) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/guest-token`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setState({ ...state, revoked: true });
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 미지원 — 무시
    }
  };

  return (
    <section className="bg-admin-card rounded-xl overflow-hidden shadow-sm border border-[#334155]">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-2">
        <span className="material-symbols-outlined text-admin-primary text-[18px]">link</span>
        <h2 className="font-bold text-sm text-white">{t("title")}</h2>
        {active && (
          <span className="ml-auto px-2 py-0.5 bg-admin-primary/10 text-admin-primary text-[10px] font-bold rounded uppercase">
            {t("active")}
          </span>
        )}
        {state?.revoked && (
          <span className="ml-auto px-2 py-0.5 bg-red-500/10 text-red-400 text-[10px] font-bold rounded uppercase">
            {t("revoked")}
          </span>
        )}
      </div>

      <div className="p-6 space-y-4">
        <p className="text-xs text-admin-muted leading-relaxed">{t("desc")}</p>

        {active && state && (
          <>
            <div className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 flex items-center gap-2">
              <span className="flex-1 text-xs text-slate-300 font-mono break-all">{fullUrl}</span>
              <button
                type="button"
                onClick={copy}
                className="shrink-0 text-admin-primary text-xs font-bold hover:underline whitespace-nowrap"
              >
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
            {state.signedAt && (
              <p className="text-[11px] text-green-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">task_alt</span>
                {t("signed")}
              </p>
            )}
          </>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={issue}
            disabled={busy}
            className="flex-1 h-10 bg-admin-primary disabled:opacity-50 text-white text-sm font-bold rounded-lg active:scale-[0.98] transition-transform"
          >
            {active ? t("reissue") : t("issue")}
          </button>
          {active && (
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="h-10 px-4 border border-red-500/30 text-red-400 disabled:opacity-50 text-sm font-bold rounded-lg hover:bg-red-500/10 active:scale-[0.98] transition-transform"
            >
              {t("revoke")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
