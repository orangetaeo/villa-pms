"use client";

// 이용 동의서 편집 카드 (T-admin-agreement-editor, 2026-06-25 개정).
// 운영자는 한국어 제목+본문(1.2.3. 자유 번호)만 입력하고, "번역하기"로 vi·en·zh·ru를 자동 생성.
// 다른 언어는 직접 입력하지 않음(읽기전용 미리보기). 저장(PUT /api/agreement) 시 5개 언어 발행, rev +1.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AGREEMENT_LANGS,
  AGREEMENT_LANG_LABELS,
  agreementVersionLabel,
  type AgreementContent,
  type AgreementLang,
} from "@/lib/agreement";

// 한국어를 제외한 발행 언어 — 번역 결과 미리보기 대상
const OTHER_LANGS = AGREEMENT_LANGS.filter((l): l is AgreementLang => l !== "ko");

export default function AgreementForm({ initial }: { initial: AgreementContent }) {
  const t = useTranslations("adminSettings.agreement");
  const router = useRouter();
  const [content, setContent] = useState<AgreementContent>(initial);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  // 한국어 수정 후 미번역 상태 — 다른 언어가 stale이므로 저장 차단(번역 강제)
  const [koDirty, setKoDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const setKoTitle = (value: string) => {
    setContent((c) => ({ ...c, docTitle: { ...c.docTitle, ko: value } }));
    setKoDirty(true);
    setMessage(null);
  };
  const setKoBody = (value: string) => {
    setContent((c) => ({ ...c, body: { ...c.body, ko: value } }));
    setKoDirty(true);
    setMessage(null);
  };

  const koReady = content.docTitle.ko.trim().length > 0 && content.body.ko.trim().length > 0;

  // 번역 — 한국어 원문 → vi·en·zh·ru 일괄 생성(서버 Gemini). 결과를 상태에 병합.
  const onTranslate = async () => {
    if (!koReady) {
      setMessage({ ok: false, text: t("emptyKo") });
      return;
    }
    setTranslating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/agreement/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docTitle: content.docTitle.ko, body: content.body.ko }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        const key = data?.error === "GEMINI_NOT_CONFIGURED" ? "geminiError" : "translateFailed";
        setMessage({ ok: false, text: t(key) });
        return;
      }
      const data = (await res.json()) as {
        docTitle: Record<string, string>;
        body: Record<string, string>;
      };
      setContent((c) => {
        const docTitle = { ...c.docTitle };
        const body = { ...c.body };
        for (const lang of OTHER_LANGS) {
          docTitle[lang] = data.docTitle[lang] ?? "";
          body[lang] = data.body[lang] ?? "";
        }
        return { ...c, docTitle, body };
      });
      setKoDirty(false);
      setMessage({ ok: true, text: t("translated") });
    } catch {
      setMessage({ ok: false, text: t("translateFailed") });
    } finally {
      setTranslating(false);
    }
  };

  // 발행 저장 — 5개 언어 전체. 한국어 미번역(koDirty) 시 차단.
  const onSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/agreement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docTitle: content.docTitle, body: content.body }),
      });
      if (res.status === 400) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage({ ok: false, text: data?.error === "INCOMPLETE" ? t("incomplete") : t("error") });
        return;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = (await res.json()) as { content: AgreementContent };
      setContent(data.content);
      setKoDirty(false);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("error") });
    } finally {
      setSaving(false);
    }
  };

  // 번역 결과 존재 여부(미리보기 노출 조건) — 한 언어라도 본문이 차 있으면 표시
  const hasTranslations = OTHER_LANGS.some((l) => content.body[l]?.trim());

  return (
    <section className="bg-admin-card rounded-xl border border-slate-800 shadow-lg flex flex-col">
      {/* 카드 헤더 */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">contract</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("title")}
          </h2>
        </div>
        <span className="text-xs font-bold text-slate-400 bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1 tabular-nums">
          {t("versionLabel")} {agreementVersionLabel(content)}
        </span>
      </div>

      <div className="p-6 md:p-8 space-y-6">
        <p className="text-sm text-slate-400">{t("description")}</p>

        {/* 한국어 제목 */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide">
            {t("koTitleLabel")}
          </label>
          <input
            type="text"
            value={content.docTitle.ko}
            onChange={(e) => setKoTitle(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:border-admin-primary focus:outline-none"
          />
        </div>

        {/* 한국어 본문 — 자유 번호 입력 */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide">
            {t("koBodyLabel")}
          </label>
          <textarea
            value={content.body.ko}
            onChange={(e) => setKoBody(e.target.value)}
            rows={10}
            placeholder={t("bodyPlaceholder")}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-sm text-slate-200 leading-relaxed focus:border-admin-primary focus:outline-none resize-y"
          />
          <p className="text-[11px] text-slate-500">{t("bodyHint")}</p>
        </div>

        {/* 번역 버튼 */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={onTranslate}
            disabled={translating || !koReady}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-100 px-5 py-2.5 rounded-lg font-bold text-sm transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-lg">translate</span>
            {translating ? t("translating") : t("translate")}
          </button>
          {koDirty && hasTranslations && (
            <span className="text-xs font-medium text-amber-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">warning</span>
              {t("needTranslate")}
            </span>
          )}
        </div>

        {/* 번역 결과 미리보기 — 읽기전용(직접 입력 안 함). 운영자 확인용 */}
        {hasTranslations && (
          <details className="rounded-lg border border-slate-800 bg-slate-900/40">
            <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center gap-2">
              <span className="material-symbols-outlined text-base text-admin-primary">visibility</span>
              {t("otherLangs")}
            </summary>
            <div className="px-4 pb-4 space-y-4">
              {OTHER_LANGS.map((lang) => (
                <div key={lang} className="space-y-1">
                  <p className="text-[11px] font-bold text-slate-400">{AGREEMENT_LANG_LABELS[lang]}</p>
                  <p className="text-xs font-bold text-slate-300">{content.docTitle[lang] || "—"}</p>
                  <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line bg-slate-900 border border-slate-800 rounded p-2">
                    {content.body[lang] || "—"}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* 저장(발행) */}
        <div className="h-px bg-slate-800 w-full" />
        <div className="flex justify-end items-center gap-3">
          {message && (
            <span
              role="status"
              className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
            >
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !koReady || koDirty}
            title={koDirty ? t("needTranslate") : undefined}
            className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-lg font-bold text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-lg">save</span>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </section>
  );
}
