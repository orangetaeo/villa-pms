"use client";

// 빌라 베트남어 병기명(nameVi) 편집기 (ADR-0020) — ADMIN 빌라 상세 전용.
// "Gemini 제안" 버튼으로 한국어명 음역 제안 → ADMIN이 검수·수정·저장. 저장값만 nameVi에 반영.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatVillaName } from "@/lib/villa-name";
import CollapsibleCard from "@/components/admin/collapsible-card";

export default function NameViEditor({
  villaId,
  name,
  initialNameVi,
}: {
  villaId: string;
  name: string;
  initialNameVi: string | null;
}) {
  const t = useTranslations("adminVillas.detail.nameVi");
  const router = useRouter();
  const [value, setValue] = useState(initialNameVi ?? "");
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSuggest() {
    setSuggesting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/villas/${villaId}/name-vi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest" }),
      });
      if (res.status === 503) {
        setError(t("errGemini"));
        return;
      }
      if (!res.ok) {
        setError(t("errSuggest"));
        return;
      }
      const data = (await res.json()) as { suggestion?: string };
      if (data.suggestion) setValue(data.suggestion);
    } catch {
      setError(t("errSuggest"));
    } finally {
      setSuggesting(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/villas/${villaId}/name-vi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", nameVi: value }),
      });
      if (!res.ok) {
        setError(t("errSave"));
        return;
      }
      setSaved(true);
      router.refresh(); // 헤더 등 서버 렌더 갱신
    } catch {
      setError(t("errSave"));
    } finally {
      setSaving(false);
    }
  }

  const previewName = formatVillaName({ name, nameVi: value });

  return (
    <CollapsibleCard title={t("title")} icon="translate" defaultOpen>
      <p className="text-xs text-admin-muted mb-3">{t("desc")}</p>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          maxLength={100}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder={t("placeholder")}
          className="flex-1 rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-admin-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={onSuggest}
          disabled={suggesting || saving}
          className="inline-flex items-center gap-1 rounded-lg border border-admin-primary/40 bg-admin-primary/10 px-3 py-2 text-xs font-bold text-admin-primary transition-colors hover:bg-admin-primary/20 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">auto_awesome</span>
          {suggesting ? t("suggesting") : t("suggest")}
        </button>
      </div>

      {/* 병기 미리보기 — 비운영자 화면에 표시될 형태 */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-slate-500">{t("preview")}</span>
        <span className="font-medium text-slate-200">{previewName}</span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || suggesting}
          className="rounded-lg bg-admin-primary px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? t("saving") : t("save")}
        </button>
        {saved && <span className="text-xs font-medium text-green-500">{t("saved")}</span>}
        {error && <span className="text-xs font-medium text-red-500">{error}</span>}
      </div>
    </CollapsibleCard>
  );
}
