"use client";

// 빌라 한국어명(name)·베트남어 병기명(nameVi) 편집기 (ADR-0020) — ADMIN 빌라 상세 전용.
// ADMIN만 한국어 원명과 베트남어 병기명을 함께 수정할 수 있다(공급자는 이름 변경권 없음).
// nameVi가 비어 있으면 화면 진입 시 Gemini 음역을 "자동으로" 채워 넣는다(수동 버튼 클릭 불필요).
// "제안" 버튼은 현재 입력 중인 한국어명 초안 기준으로 음역을 재생성한다. 저장값만 반영.
import { useEffect, useRef, useState } from "react";
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
  const [nameValue, setNameValue] = useState(name);
  const [value, setValue] = useState(initialNameVi ?? "");
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 자동 제안 1회 가드 — nameVi가 비어 있을 때만, 마운트 시 한 번(엄격모드 이중 호출·재렌더 재요청 방지).
  const autoSuggestedRef = useRef(false);

  async function onSuggest() {
    setSuggesting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/villas/${villaId}/name-vi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 저장 전 새 이름 기준으로 음역하도록 현재 입력 중인 초안 name을 함께 전달.
        body: JSON.stringify({ action: "suggest", name: nameValue }),
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
        body: JSON.stringify({ action: "save", name: nameValue, nameVi: value }),
      });
      if (!res.ok) {
        setError(t("errSave"));
        return;
      }
      setSaved(true);
      router.refresh(); // 헤더·목록 등 서버 렌더 갱신(빌라명 즉시 반영)
    } catch {
      setError(t("errSave"));
    } finally {
      setSaving(false);
    }
  }

  // nameVi가 비어 있으면 진입 시 자동으로 Gemini 음역 제안을 채운다(수동 "제안" 버튼 클릭 불필요).
  useEffect(() => {
    if (autoSuggestedRef.current) return;
    if ((initialNameVi ?? "").trim().length > 0) return; // 이미 확정값 있으면 자동 제안 안 함
    if (name.trim().length === 0) return;
    autoSuggestedRef.current = true;
    void onSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewName = formatVillaName({ name: nameValue, nameVi: value });
  // 저장된 원명과 달라졌으면 nameVi가 구명 기준일 수 있으므로 재확인 안내.
  const nameChanged = nameValue.trim() !== name.trim();

  return (
    <CollapsibleCard title={t("title")} icon="translate" defaultOpen>
      <p className="text-xs text-admin-muted mb-3">{t("desc")}</p>

      {/* 한국어 원명(name) — 운영자 판매 식별자. ADMIN만 편집 */}
      <label className="mb-1 block text-xs font-medium text-slate-400">{t("nameLabel")}</label>
      <input
        type="text"
        value={nameValue}
        maxLength={100}
        onChange={(e) => {
          setNameValue(e.target.value);
          setSaved(false);
        }}
        placeholder={t("namePlaceholder")}
        className="mb-2 w-full rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-admin-primary focus:outline-none"
      />
      {nameChanged && (
        <p className="mb-3 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-400">
          {t("nameChangedHint")}
        </p>
      )}

      {/* 베트남어 병기명(nameVi) */}
      <label className="mb-1 block text-xs font-medium text-slate-400">{t("nameViLabel")}</label>
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
