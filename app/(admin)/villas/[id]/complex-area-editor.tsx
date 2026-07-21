"use client";

// 빌라 지역(단지) 인라인 편집기 (ADR-0046, T-admin-villa-region) — ADMIN 빌라 상세 전용.
//   활성 마스터(ComplexArea) 드롭다운 + "지역 없음"(해제). 선택 후 저장 시 PATCH.
//   ★운영자 화면이라 name (nameKo) 병기 표시 허용(공급자 화면만 nameKo 미노출).
//   ★현재 빌라의 complexAreaId가 비활성 마스터라 목록에 없으면 현재 값을 옵션에 보존(조용한 해제 방지).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import CollapsibleCard from "@/components/admin/collapsible-card";

export interface ComplexAreaOption {
  id: string;
  name: string;
  nameKo: string | null;
}

export default function ComplexAreaEditor({
  villaId,
  initialComplexAreaId,
  initialComplex,
  areas,
}: {
  villaId: string;
  initialComplexAreaId: string | null;
  initialComplex: string | null;
  areas: ComplexAreaOption[];
}) {
  const t = useTranslations("adminVillas.detail.complexArea");
  const router = useRouter();
  const [selected, setSelected] = useState(initialComplexAreaId ?? "");
  // 표시용 현재 지역명 — 저장 성공 시 낙관적 갱신(서버 refresh 전 즉시 반영)
  const [currentComplex, setCurrentComplex] = useState(initialComplex);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 비활성 마스터 보존 — 현재 지정된 id가 활성 목록에 없으면 현재 값을 옵션으로 추가해 조용한 해제를 막는다.
  const currentInList =
    initialComplexAreaId != null && areas.some((a) => a.id === initialComplexAreaId);
  const showInactiveOption = initialComplexAreaId != null && !currentInList;

  const optionLabel = (a: ComplexAreaOption) =>
    a.nameKo ? `${a.name} (${a.nameKo})` : a.name;

  async function onSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/villas/${villaId}/complex-area`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complexAreaId: selected || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error === "UNKNOWN_COMPLEX" ? t("errUnknown") : t("errSave"));
        return;
      }
      const data = (await res.json()) as { complexAreaId: string | null; complex: string | null };
      setCurrentComplex(data.complex);
      setSaved(true);
      router.refresh(); // 목록·검색 등 서버 렌더 갱신(지역 즉시 반영)
    } catch {
      setError(t("errSave"));
    } finally {
      setSaving(false);
    }
  }

  const dirty = (selected || "") !== (initialComplexAreaId ?? "");

  return (
    <CollapsibleCard title={t("title")} icon="location_city" defaultOpen>
      <p className="text-xs text-admin-muted mb-3">{t("desc")}</p>

      {/* 현재 지정 지역 표시 */}
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-slate-500">{t("current")}</span>
        <span className="font-medium text-slate-200">{currentComplex ?? t("none")}</span>
      </div>

      <label className="mb-1 block text-xs font-medium text-slate-400">{t("label")}</label>
      <select
        value={selected}
        disabled={saving}
        onChange={(e) => {
          setSelected(e.target.value);
          setSaved(false);
        }}
        className="w-full rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm text-white focus:border-admin-primary focus:outline-none disabled:opacity-50"
      >
        {/* 지역 없음 = 해제(null) */}
        <option value="">{t("none")}</option>
        {/* 비활성 마스터 보존 옵션 — 현재 값이 활성 목록에 없을 때만 */}
        {showInactiveOption && (
          <option value={initialComplexAreaId as string}>
            {(initialComplex ?? (initialComplexAreaId as string)) + " " + t("inactiveSuffix")}
          </option>
        )}
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {optionLabel(a)}
          </option>
        ))}
      </select>

      {areas.length === 0 && !showInactiveOption && (
        <p className="mt-2 text-xs text-amber-400">{t("empty")}</p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
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
