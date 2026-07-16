"use client";

// 인스타그램 연동 설정(접이식) — GET /api/instagram/settings 로 로드, PUT 로 저장.
//   ★ 액세스 토큰 write-only: 저장 여부 + 말미 4자만 표시(평문 미노출). 입력 비우면 기존 토큰 보존.
//   ★ PUT 은 OWNER/ADMIN(isSystemAdmin)만 — canEdit=false 면 조회 전용(입력 잠금 + 안내).
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface Settings {
  igUserId: string | null;
  graphBase: string;
  accessTokenSet: boolean;
  accessTokenLast4: string | null;
  autopostPaused: boolean;
}

export default function InstagramSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations("adminInstagram");
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  // 폼 상태
  const [igUserId, setIgUserId] = useState("");
  const [accessToken, setAccessToken] = useState(""); // write-only 입력(비우면 보존)
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/instagram/settings", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as Settings;
        if (!alive) return;
        setLoaded(data);
        setIgUserId(data.igUserId ?? "");
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
        igUserId: igUserId.trim(),
        autopostPaused: paused,
      };
      if (accessToken.trim()) body.accessToken = accessToken.trim();
      const res = await fetch("/api/instagram/settings", {
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
      setLoaded((prev) => (prev ? { ...prev, ...data } : (data as Settings)));
      setAccessToken(""); // 저장 후 입력 비움(write-only)
      setMsg({ text: t("settings.saved"), kind: "ok" });
    } catch {
      setMsg({ text: t("settings.saveError"), kind: "err" });
    } finally {
      setSaving(false);
    }
  };

  const tokenState = loaded?.accessTokenSet
    ? t("settings.accessTokenState", { last4: loaded.accessTokenLast4 ?? "" })
    : t("settings.accessTokenUnset");

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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {t("settings.igUserId")}
                  </span>
                  <input
                    type="text"
                    value={igUserId}
                    onChange={(e) => setIgUserId(e.target.value)}
                    placeholder={t("settings.igUserIdPlaceholder")}
                    disabled={!canEdit}
                    inputMode="numeric"
                    className={inputCls}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {t("settings.graphBase")}
                  </span>
                  <input
                    type="text"
                    value={loaded.graphBase}
                    readOnly
                    disabled
                    className={`${inputCls} text-slate-500`}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {t("settings.accessToken")}
                  </span>
                  <span
                    className={`text-[11px] font-bold ${
                      loaded.accessTokenSet ? "text-emerald-300" : "text-slate-500"
                    }`}
                  >
                    {tokenState}
                  </span>
                </span>
                <input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={t("settings.accessTokenPlaceholder")}
                  autoComplete="off"
                  disabled={!canEdit}
                  className={inputCls}
                />
                <span className="text-[11px] text-slate-500">{t("settings.accessTokenHint")}</span>
              </label>

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
                  className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    paused ? "bg-amber-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
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
