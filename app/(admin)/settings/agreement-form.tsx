"use client";

// 이용 동의서 편집 카드 (T-admin-agreement-editor) — 전 빌라 공용 단일 동의서.
// 5개 언어(ko/vi/en/zh/ru) × 조항(c1·c2·pool·c4~c7)을 언어 탭으로 편집, 저장 시 rev +1.
// 저장은 PUT /api/agreement — 모든 항목 필수(법적 완결성). 상태는 전체 언어를 보관, 저장은 일괄.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AGREEMENT_LANGS,
  AGREEMENT_LANG_LABELS,
  AGREEMENT_CLAUSE_KEYS,
  agreementVersionLabel,
  type AgreementContent,
  type AgreementLang,
  type AgreementClauseKey,
} from "@/lib/agreement";

export default function AgreementForm({ initial }: { initial: AgreementContent }) {
  const t = useTranslations("adminSettings.agreement");
  const router = useRouter();
  const [content, setContent] = useState<AgreementContent>(initial);
  const [lang, setLang] = useState<AgreementLang>("ko");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const setDocTitle = (value: string) => {
    setContent((c) => ({ ...c, docTitle: { ...c.docTitle, [lang]: value } }));
    setDirty(true);
    setMessage(null);
  };

  const setClause = (key: AgreementClauseKey, value: string) => {
    setContent((c) => ({
      ...c,
      clauses: { ...c.clauses, [key]: { ...c.clauses[key], [lang]: value } },
    }));
    setDirty(true);
    setMessage(null);
  };

  // 현재 언어에서 비어있는 항목 수 (탭 배지) — 누락 가시화
  const emptyCountFor = (l: AgreementLang): number => {
    let n = content.docTitle[l]?.trim() ? 0 : 1;
    for (const key of AGREEMENT_CLAUSE_KEYS) {
      if (!content.clauses[key]?.[l]?.trim()) n += 1;
    }
    return n;
  };

  const onSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/agreement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docTitle: content.docTitle, clauses: content.clauses }),
      });
      if (res.status === 400) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage({ ok: false, text: data?.error === "INCOMPLETE" ? t("incomplete") : t("error") });
        return;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = (await res.json()) as { content: AgreementContent };
      setContent(data.content);
      setDirty(false);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("error") });
    } finally {
      setSaving(false);
    }
  };

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

        {/* 언어 탭 — 비어있는 항목 수 배지로 누락 가시화 */}
        <div className="flex flex-wrap gap-2">
          {AGREEMENT_LANGS.map((l) => {
            const empties = emptyCountFor(l);
            const active = l === lang;
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 border ${
                  active
                    ? "bg-admin-primary text-white border-admin-primary"
                    : "bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-600"
                }`}
              >
                {AGREEMENT_LANG_LABELS[l]}
                {empties > 0 && (
                  <span className="w-5 h-5 flex items-center justify-center rounded-full bg-red-500/20 text-red-400 text-[10px] font-black tabular-nums">
                    {empties}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 문서 제목 */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide">
            {t("docTitleLabel")}
          </label>
          <input
            type="text"
            value={content.docTitle[lang] ?? ""}
            onChange={(e) => setDocTitle(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:border-admin-primary focus:outline-none"
          />
        </div>

        {/* 조항 */}
        <div className="space-y-5">
          {AGREEMENT_CLAUSE_KEYS.map((key, i) => (
            <div key={key} className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-300">
                <span className="w-6 h-6 flex items-center justify-center bg-slate-800 rounded text-[11px] tabular-nums">
                  {i + 1}
                </span>
                {t(`clauseLabels.${key}`)}
                {key === "pool" && (
                  <span className="text-[11px] font-medium text-blue-400 normal-case">
                    {t("poolHint")}
                  </span>
                )}
              </label>
              <textarea
                value={content.clauses[key]?.[lang] ?? ""}
                onChange={(e) => setClause(key, e.target.value)}
                rows={2}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 leading-relaxed focus:border-admin-primary focus:outline-none resize-y"
              />
            </div>
          ))}
        </div>

        {/* 저장 */}
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
            disabled={saving || !dirty}
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
