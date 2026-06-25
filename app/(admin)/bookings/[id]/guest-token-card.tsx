"use client";

// 게스트 셀프 체크인 링크 카드 (ADR-0019 S3, 운영자 다크 톤) — 예약 상세 우측.
//   발급/재발급(POST) · 회수(DELETE) · 링크 복사 + QR(qrcode.react).
//   QR 2종: 체크인(/g/<token>) · 옵션요청(/g/<token>/options). 고객에게 화면으로 보여주거나 인쇄.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { QRCodeCanvas } from "qrcode.react";

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
  const [copied, setCopied] = useState<string | null>(null); // 복사된 URL 키
  const [error, setError] = useState<string | null>(null);

  const active = state != null && !state.revoked;
  const fullUrl = state ? `${origin}${state.url}` : "";
  const optionsUrl = state ? `${origin}${state.url}/options` : "";

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

  const copy = async (url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
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
            {/* QR 2종 — 체크인 / 옵션요청. 고객 화면 노출·인쇄용. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <QrBlock
                label={t("qrCheckin")}
                url={fullUrl}
                copied={copied === fullUrl}
                onCopy={() => copy(fullUrl)}
                t={t}
              />
              <QrBlock
                label={t("qrOptions")}
                url={optionsUrl}
                copied={copied === optionsUrl}
                onCopy={() => copy(optionsUrl)}
                t={t}
              />
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

// ── QR 카드 (체크인 / 옵션요청 공통) ──────────────────────────────────────────
function QrBlock({
  label,
  url,
  copied,
  onCopy,
  t,
}: {
  label: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 flex flex-col items-center gap-2.5">
      <span className="text-[11px] font-bold text-slate-300 text-center">{label}</span>
      {/* 흰 배경 — QR 스캔 대비. origin 없으면(상대경로) 빈 url이라 QR 생략 */}
      {url ? (
        <div className="bg-white rounded-md p-2">
          <QRCodeCanvas value={url} size={128} level="M" marginSize={0} />
        </div>
      ) : (
        <div className="w-[144px] h-[144px] rounded-md bg-slate-800 flex items-center justify-center text-slate-600 text-[10px] text-center px-2">
          {t("qrUnavailable")}
        </div>
      )}
      <span className="w-full text-[10px] text-slate-400 font-mono break-all text-center leading-snug">
        {url}
      </span>
      <button
        type="button"
        onClick={onCopy}
        disabled={!url}
        className="text-admin-primary text-xs font-bold hover:underline whitespace-nowrap disabled:opacity-40 disabled:no-underline"
      >
        {copied ? t("copied") : t("copyLink")}
      </button>
    </div>
  );
}
