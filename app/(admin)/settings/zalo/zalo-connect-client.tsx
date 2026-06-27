"use client";

// Zalo 봇 연결 클라이언트 (ADR-0006 S1)
// 흐름: 미연결 → "QR 생성"(POST /api/zalo/qr) → QR 이미지 표시 → 폴링(GET /api/zalo/status)으로
//       connected 감지 → 연결됨(displayName·lastConnected) 표시 → "연결 해제"(DELETE /api/zalo/qr).
// 보안: 응답에 credential 없음(D6.2). 화면은 status/displayName/lastConnected만 다룬다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type BotStatus = "disconnected" | "qr_pending" | "connected" | "error";

interface StatusPayload {
  connected: boolean;
  status: BotStatus;
  displayName: string | null;
  lastConnected: string | null;
  lastError: string | null;
}

export default function ZaloConnectClient({
  initialStatus,
  isSystemBotAccount = false,
}: {
  initialStatus: StatusPayload;
  /** 이 계정이 시스템 알림 발송도 겸하는 시스템봇인지 (ADR-0007 통합 모드 D1) — 안내 라벨용 */
  isSystemBotAccount?: boolean;
}) {
  const t = useTranslations("adminZalo");
  const [status, setStatus] = useState<StatusPayload>(initialStatus);
  const [qr, setQr] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/zalo/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as StatusPayload;
      setStatus(data);
      if (data.connected) {
        setQr(null);
      }
    } catch {
      /* 폴링 실패는 조용히 무시 (다음 주기 재시도) */
    }
  }, []);

  // QR 대기/생성 중에는 상태 폴링 (connected 감지)
  useEffect(() => {
    const shouldPoll = !status.connected && (qr !== null || status.status === "qr_pending");
    if (shouldPoll) {
      if (!pollRef.current) {
        pollRef.current = setInterval(fetchStatus, 2500);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status.connected, status.status, qr, fetchStatus]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/zalo/qr", { method: "POST" });
      if (!res.ok) throw new Error("qr failed");
      const data = (await res.json()) as { qrImageBase64?: string };
      if (!data.qrImageBase64) throw new Error("no qr");
      setQr(data.qrImageBase64);
      setStatus((s) => ({ ...s, status: "qr_pending" }));
    } catch {
      setError(t("errorGenerate"));
    } finally {
      setGenerating(false);
    }
  }, [t]);

  const handleDisconnect = useCallback(async () => {
    if (!confirm(t("confirmDisconnect"))) return;
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/zalo/qr", { method: "DELETE" });
      if (!res.ok) throw new Error("disconnect failed");
      setQr(null);
      await fetchStatus();
    } catch {
      setError(t("errorDisconnect"));
    } finally {
      setDisconnecting(false);
    }
  }, [t, fetchStatus]);

  const statusLabel: Record<BotStatus, string> = {
    connected: t("statusConnected"),
    disconnected: t("statusDisconnected"),
    qr_pending: t("statusQrPending"),
    error: t("statusError"),
  };
  const badgeClass: Record<BotStatus, string> = {
    connected: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    disconnected: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    qr_pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    error: "bg-red-500/15 text-red-400 border-red-500/30",
  };

  // base64 QR — 이미 data URI인지 raw base64인지 판별
  const qrSrc = qr ? (qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`) : null;

  return (
    <div className="bg-admin-card border border-slate-800 rounded-xl p-6 space-y-6">
      {/* 헤더: 카드 제목 + 상태 배지 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">{t("cardTitle")}</h2>
        <span
          className={`text-xs font-bold px-3 py-1 rounded-full border ${badgeClass[status.status]}`}
        >
          {statusLabel[status.status]}
        </span>
      </div>

      {/* ADR-0007 통합 모드(D1) 안내 — 시스템봇 겸용 계정이면 시스템 알림 발송 라벨, 아니면 개인 채팅 전용 */}
      <div
        className={`text-xs rounded-lg px-3 py-2 border ${
          isSystemBotAccount
            ? "bg-sky-500/10 text-sky-300 border-sky-500/20"
            : "bg-slate-500/10 text-slate-400 border-slate-700"
        }`}
      >
        {isSystemBotAccount
          ? "이 계정은 시스템 알림(예약·청소·정산 등) 발송도 함께 담당합니다. 연결 해제 시 알림 발송이 중단됩니다."
          : "이 계정은 내 개인 채팅 전용입니다. 시스템 알림은 운영 대표 계정에서 발송됩니다."}
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {status.connected ? (
        /* ── 연결됨 상태 ── */
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-emerald-400 text-3xl">
              check_circle
            </span>
            <div>
              <p className="text-sm text-slate-400">{t("connectedAs")}</p>
              <p className="text-base font-bold text-white">
                {status.displayName ?? "Zalo"}
              </p>
            </div>
          </div>
          {status.lastConnected && (
            // suppressHydrationWarning: toLocaleString이 서버(Node ICU)와 브라우저 ICU 간 미세하게
            // 다른 문자열을 만들어 하이드레이션 텍스트 불일치(React #418)를 유발 → 같은 인스턴트라 클라 렌더 채택.
            <p className="text-xs text-slate-500" suppressHydrationWarning>
              {t("lastConnected")}:{" "}
              {new Date(status.lastConnected).toLocaleString("ko-KR", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}
            </p>
          )}
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-red-600/90 hover:bg-red-600 text-white disabled:opacity-50 transition-colors"
          >
            {disconnecting ? t("disconnecting") : t("disconnect")}
          </button>
        </div>
      ) : (
        /* ── 미연결 / QR 대기 상태 ── */
        <div className="space-y-5">
          {!qrSrc && (
            <>
              <p className="text-sm text-slate-400">{t("notConnectedDesc")}</p>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="px-5 py-2.5 text-sm font-bold rounded-lg bg-admin-primary hover:opacity-90 text-white disabled:opacity-50 transition-opacity inline-flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
                {generating ? t("generating") : t("generateQr")}
              </button>
            </>
          )}

          {qrSrc && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">{t("qrInstruction")}</p>
              <div className="flex flex-col items-center gap-3">
                {/* QR 이미지 — base64. next/image 불필요(인라인 data URI) */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrSrc}
                  alt="Zalo QR"
                  className="w-56 h-56 rounded-lg bg-white p-2"
                />
                <div className="flex items-center gap-2 text-amber-400 text-sm">
                  <span className="material-symbols-outlined text-[18px] animate-pulse">
                    sync
                  </span>
                  {t("qrWaiting")}
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="text-xs text-slate-400 hover:text-white underline disabled:opacity-50"
                >
                  {t("refresh")}
                </button>
              </div>
            </div>
          )}

          {status.lastError && status.status === "error" && (
            <p className="text-xs text-red-400">{status.lastError}</p>
          )}
        </div>
      )}
    </div>
  );
}
