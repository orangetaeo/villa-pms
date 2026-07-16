"use client";

// 유튜브 연동 설정(접이식) — GET /api/youtube/settings 로 로드, PUT 로 저장.
//   ★ 클라이언트 시크릿 write-only: 설정 여부만 표시(평문 미노출). 입력 비우면 기존 시크릿 보존.
//   ★ 유튜브 계정 연결 = OAuth. 버튼은 /api/youtube/oauth/start 로 "전체 페이지 리다이렉트"(fetch 아님).
//      복귀 시 ?connected=1 / ?error=코드 → 큐가 토스트 표시. 연결 상태 = refreshTokenSet.
//   ★ PUT 은 OWNER/ADMIN(isSystemAdmin)만 — canEdit=false 면 조회 전용(입력 잠금 + 안내).
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const PRIVACY_OPTIONS = ["public", "unlisted", "private"] as const;

interface Settings {
  clientId: string;
  clientSecretSet: boolean;
  refreshTokenSet: boolean;
  autopostPaused: boolean;
  privacyStatus: string;
  shortsPerDay: number;
  dailyUploadCap: number;
}

export default function YoutubeSettingsPanel({
  canEdit,
  defaultOpen = false,
}: {
  canEdit: boolean;
  defaultOpen?: boolean;
}) {
  const t = useTranslations("adminYoutube");
  const [open, setOpen] = useState(defaultOpen);
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  // 폼 상태
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState(""); // write-only 입력(비우면 보존)
  const [privacyStatus, setPrivacyStatus] = useState<string>("unlisted");
  const [shortsPerDay, setShortsPerDay] = useState(0);
  const [dailyUploadCap, setDailyUploadCap] = useState(6);
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/youtube/settings", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as Settings;
        if (!alive) return;
        setLoaded(data);
        setClientId(data.clientId ?? "");
        setPrivacyStatus(data.privacyStatus);
        setShortsPerDay(data.shortsPerDay);
        setDailyUploadCap(data.dailyUploadCap);
        setPaused(data.autopostPaused);
      } catch {
        if (alive) setError(t("settings.loadError"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [t]);

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        clientId: clientId.trim(),
        autopostPaused: paused,
        privacyStatus,
        shortsPerDay,
        dailyUploadCap,
      };
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      const res = await fetch("/api/youtube/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 403) {
        setMsg({ text: t("settings.forbidden"), kind: "err" });
        return;
      }
      if (!res.ok) {
        setMsg({ text: t("settings.saveError"), kind: "err" });
        return;
      }
      const data = (await res.json()) as Settings;
      setLoaded((prev) => (prev ? { ...prev, ...data } : data));
      setClientSecret(""); // 저장 후 입력 비움(write-only)
      setMsg({ text: t("settings.saved"), kind: "ok" });
    } catch {
      setMsg({ text: t("settings.saveError"), kind: "err" });
    } finally {
      setSaving(false);
    }
  };

  const secretState = loaded?.clientSecretSet
    ? t("settings.clientSecretState")
    : t("settings.clientSecretUnset");

  const connected = loaded?.refreshTokenSet ?? false;

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary disabled:opacity-50";

  return (
    <div className="rounded-xl border border-slate-800/50 bg-admin-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-slate-200">
          <span className="material-symbols-outlined text-[20px] text-slate-400">tune</span>
          {t("settings.title")}
        </span>
        <span className="flex items-center gap-2">
          {loaded && (
            <>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  connected
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-slate-700 bg-slate-800 text-slate-400"
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">
                  {connected ? "link" : "link_off"}
                </span>
                {connected ? t("settings.connected") : t("settings.notConnected")}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  loaded.autopostPaused
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">
                  {loaded.autopostPaused ? "pause_circle" : "play_circle"}
                </span>
                {loaded.autopostPaused ? t("settings.autopostPaused") : t("settings.autopostActive")}
              </span>
            </>
          )}
          <span
            className={`material-symbols-outlined text-[20px] text-slate-400 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          >
            expand_more
          </span>
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-slate-800 px-4 py-4">
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : !loaded ? (
            <p className="text-sm text-slate-500">{t("loading")}</p>
          ) : (
            <>
              {!canEdit && (
                <p className="rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-[12px] text-slate-400">
                  {t("settings.readOnly")}
                </p>
              )}

              {/* OAuth 클라이언트 자격 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {t("settings.clientId")}
                  </span>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder={t("settings.clientIdPlaceholder")}
                    disabled={!canEdit}
                    autoComplete="off"
                    className={inputCls}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {t("settings.clientSecret")}
                    </span>
                    <span
                      className={`text-[11px] font-bold ${
                        loaded.clientSecretSet ? "text-emerald-300" : "text-slate-500"
                      }`}
                    >
                      {secretState}
                    </span>
                  </span>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={t("settings.clientSecretPlaceholder")}
                    autoComplete="off"
                    disabled={!canEdit}
                    className={inputCls}
                  />
                  <span className="text-[11px] text-slate-500">{t("settings.clientSecretHint")}</span>
                </label>
              </div>

              {/* 유튜브 계정 연결(OAuth) — 전체 페이지 리다이렉트 버튼 */}
              <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-3">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-200">
                    {t("settings.connectTitle")}
                  </span>
                  {connected && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300">
                      <span className="material-symbols-outlined text-[15px]">check_circle</span>
                      {t("settings.connected")}
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-slate-500">{t("settings.connectHint")}</span>
                {canEdit ? (
                  <a
                    href="/api/youtube/oauth/start"
                    className={`inline-flex w-fit items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition-all active:scale-[0.98] ${
                      connected
                        ? "border border-slate-600 text-slate-200 hover:bg-slate-800"
                        : "bg-red-600 text-white hover:bg-red-500"
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">smart_display</span>
                    {connected ? t("settings.reconnect") : t("settings.connect")}
                  </a>
                ) : (
                  <p className="text-[11px] text-slate-500">{t("settings.connectReadOnly")}</p>
                )}
              </div>

              {/* 공개 상태 */}
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {t("settings.privacyStatus")}
                </span>
                <select
                  value={privacyStatus}
                  onChange={(e) => setPrivacyStatus(e.target.value)}
                  disabled={!canEdit}
                  className={`${inputCls} font-bold`}
                >
                  {PRIVACY_OPTIONS.map((p) => (
                    <option key={p} value={p} className="bg-slate-900">
                      {t(`settings.privacy.${p}`)}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-amber-400/90">{t("settings.privacyHint")}</span>
              </label>

              {/* 발행량 상한 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {t("settings.shortsPerDay")}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={shortsPerDay}
                    onChange={(e) =>
                      setShortsPerDay(Math.max(0, Math.min(10, Number(e.target.value) || 0)))
                    }
                    disabled={!canEdit}
                    className={`${inputCls} tabular-nums`}
                  />
                  <span className="text-[11px] text-slate-500">{t("settings.shortsPerDayHint")}</span>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {t("settings.dailyUploadCap")}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={dailyUploadCap}
                    onChange={(e) =>
                      setDailyUploadCap(Math.max(0, Math.min(50, Number(e.target.value) || 0)))
                    }
                    disabled={!canEdit}
                    className={`${inputCls} tabular-nums`}
                  />
                  <span className="text-[11px] text-slate-500">
                    {t("settings.dailyUploadCapHint")}
                  </span>
                </label>
              </div>

              {/* 자동 업로드 일시정지 */}
              <label className="flex items-start justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2.5">
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-slate-200">
                    {t("settings.autopostPaused")}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {t("settings.autopostPausedHint")}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={paused}
                  disabled={!canEdit}
                  onClick={() => setPaused((v) => !v)}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    paused ? "bg-amber-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      paused ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </label>

              {canEdit && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-base">save</span>
                    {saving ? t("settings.saving") : t("settings.save")}
                  </button>
                  {msg && (
                    <span
                      className={`text-sm font-semibold ${
                        msg.kind === "ok" ? "text-emerald-300" : "text-red-400"
                      }`}
                    >
                      {msg.text}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
