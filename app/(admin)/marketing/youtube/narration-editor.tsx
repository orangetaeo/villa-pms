"use client";

// AI 나레이션 대본 편집기 (villa-clip-narration-p2) — 운영자 전용, 다크 테마.
//
// 왜 필요한가: **Gemini 대본을 그대로 발행하면 사고다.** 운영자가 4줄을 읽고 고친 뒤
//   재렌더할 수 있어야 실전에서 쓸 만하다. 이 컴포넌트가 P2의 "사람 관문"이다.
//
// 흐름: [초안 생성](POST) → 줄별 수정 → [저장] 또는 [저장 + 다시 만들기](PUT rerender:true)
//   재렌더는 editJobStatus=PENDING으로 되돌려 기존 잡 러너가 픽업한다.
//
// ★ 재TTS 비용: 문장별 캐시가 있어 **고친 문장만** 새로 합성된다 — 전체 재합성이 아니다.
// ★ 글자수 카운터: 초당 5~6음절 × 컷 2.5초 ≈ 15자. 넘으면 15초에 안 들어가므로 즉시 경고.
// ★ 숫자·영문 경고: TTS가 "브이십이"처럼 이상하게 읽는다 — 서버 검증 결과를 그대로 표시.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface Line {
  text: string;
  clipIndex: number | null;
}

type LineIssue =
  | "EMPTY"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "HAS_DIGIT_OR_LATIN"
  | "TOO_FEW_LINES"
  | "TOO_MANY_LINES";

interface Validation {
  ok: boolean;
  lineIssues: (LineIssue | null)[];
  scriptIssues: LineIssue[];
}

interface NarrationPayload {
  lines: Line[];
  voice?: string;
  validation: Validation | null;
  rules: { minChars: number; maxChars: number; minLines: number; maxLines: number };
  tts: { model: string; voice: string };
}

export default function NarrationEditor({
  shortId,
  onChanged,
  notify,
}: {
  shortId: string;
  onChanged: () => void | Promise<void>;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const t = useTranslations("adminYoutube.narration");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"draft" | "save" | "rerender" | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [rules, setRules] = useState<NarrationPayload["rules"] | null>(null);
  const [tts, setTts] = useState<{ model: string; voice: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/youtube/shorts/${shortId}/narration`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as NarrationPayload;
      setLines(data.lines);
      setValidation(data.validation);
      setRules(data.rules);
      setTts(data.tts);
      setDirty(false);
    } catch {
      notify(t("loadError"), "err");
    } finally {
      setLoading(false);
    }
  }, [shortId, notify, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Gemini 초안 생성 — 저장하지 않는다. 운영자가 확인·수정 후 저장한다. */
  const generate = async () => {
    if (busy) return;
    setBusy("draft");
    try {
      const res = await fetch(`/api/youtube/shorts/${shortId}/narration`, { method: "POST" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        notify(t(`error.${b.error ?? "generic"}`), "err");
        return;
      }
      const data = (await res.json()) as NarrationPayload;
      setLines(data.lines);
      setValidation(data.validation);
      setDirty(true); // 초안은 미저장 상태
      notify(t("draftReady"));
    } catch {
      notify(t("error.generic"), "err");
    } finally {
      setBusy(null);
    }
  };

  const save = async (rerender: boolean) => {
    if (busy) return;
    setBusy(rerender ? "rerender" : "save");
    try {
      const res = await fetch(`/api/youtube/shorts/${shortId}/narration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, rerender }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        notify(t(`error.${b.error ?? "generic"}`), "err");
        return;
      }
      const data = (await res.json()) as NarrationPayload;
      setValidation(data.validation);
      setDirty(false);
      notify(rerender ? t("rerenderQueued") : t("saved"));
      await onChanged();
    } catch {
      notify(t("error.generic"), "err");
    } finally {
      setBusy(null);
    }
  };

  const updateLine = (i: number, text: string) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, text } : l)));
    setDirty(true);
    setValidation(null); // 수정하면 이전 검증 결과는 무효 — 저장 시 서버가 다시 본다
  };

  const removeLine = (i: number) => {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
    setValidation(null);
  };

  const addLine = () => {
    setLines((prev) => [...prev, { text: "", clipIndex: prev.length }]);
    setDirty(true);
  };

  if (loading) {
    return <p className="text-xs text-slate-500">{t("loading")}</p>;
  }

  const maxChars = rules?.maxChars ?? 18;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-slate-200">{t("title")}</h4>
        {tts && (
          <span className="text-[10px] text-slate-500">
            {t("voiceInfo", { voice: tts.voice })}
          </span>
        )}
      </div>

      <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
        {t("hint", { max: maxChars })}
      </p>

      {lines.length === 0 ? (
        <p className="mb-3 rounded bg-slate-800/50 px-3 py-4 text-center text-xs text-slate-500">
          {t("empty")}
        </p>
      ) : (
        <ul className="mb-3 space-y-2">
          {lines.map((line, i) => {
            const issue = validation?.lineIssues[i] ?? null;
            const over = line.text.length > maxChars;
            return (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-2 w-10 shrink-0 text-[10px] font-bold text-slate-500">
                  {line.clipIndex == null ? t("cta") : t("cut", { n: line.clipIndex + 1 })}
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    value={line.text}
                    onChange={(e) => updateLine(i, e.target.value)}
                    maxLength={120}
                    className={`w-full rounded border bg-slate-900 px-2 py-1.5 text-sm text-slate-100 ${
                      issue || over ? "border-amber-500/60" : "border-slate-700"
                    }`}
                  />
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-amber-400">
                      {issue ? t(`issue.${issue}`, { max: maxChars }) : ""}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] tabular-nums ${
                        over ? "text-amber-400" : "text-slate-500"
                      }`}
                    >
                      {line.text.length}/{maxChars}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  aria-label={t("removeLine")}
                  className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-800 hover:text-red-400"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {validation && validation.scriptIssues.length > 0 && (
        <p className="mb-2 text-[11px] text-amber-400">
          {validation.scriptIssues.map((s) => t(`issue.${s}`, { max: maxChars })).join(" · ")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={generate}
          className="rounded border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {busy === "draft" ? t("generating") : t("generate")}
        </button>
        <button
          type="button"
          disabled={!!busy || lines.length === 0}
          onClick={addLine}
          className="rounded border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          {t("addLine")}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          disabled={!!busy || lines.length === 0 || !dirty}
          onClick={() => void save(false)}
          className="rounded border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {busy === "save" ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          disabled={!!busy || lines.length === 0}
          onClick={() => void save(true)}
          className="rounded bg-admin-primary px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy === "rerender" ? t("rerendering") : t("rerender")}
        </button>
      </div>
    </div>
  );
}
