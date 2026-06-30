"use client";

// 빌라 청소 담당자 지정 (T-villa-cleaner-assign) — ADMIN 빌라 상세 전용.
//   담당 CLEANER 선택 또는 "미지정(공급자 담당)". 변경 시 미완료 청소가 즉시 재배정됨.
//   추후 회사 직원(CLEANER)이 청소를 맡는 전환을 위한 배정 도구.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import CollapsibleCard from "@/components/admin/collapsible-card";

export interface CleanerOption {
  id: string;
  name: string;
  phone: string | null;
}

export default function CleanerAssignEditor({
  villaId,
  initialCleanerId,
  cleaners,
}: {
  villaId: string;
  initialCleanerId: string | null;
  cleaners: CleanerOption[];
}) {
  const t = useTranslations("adminVillas.detail.cleanerAssign");
  const router = useRouter();
  const [cleanerId, setCleanerId] = useState(initialCleanerId ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null); // 저장 성공 메시지(재배정 건수 포함)
  const [error, setError] = useState(false);

  async function save(nextId: string) {
    setSaving(true);
    setError(false);
    setSaved(null);
    try {
      const res = await fetch(`/api/villas/${villaId}/cleaner`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanerId: nextId || null }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { reassigned?: number };
      setSaved(t("saved", { count: data.reassigned ?? 0 }));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard title={t("title")} icon="assignment_ind" defaultOpen>
      <p className="text-xs text-admin-muted mb-3">{t("desc")}</p>

      <select
        value={cleanerId}
        disabled={saving}
        onChange={(e) => {
          setCleanerId(e.target.value);
          void save(e.target.value);
        }}
        className="w-full rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm text-white focus:border-admin-primary focus:outline-none disabled:opacity-50"
      >
        {/* 미지정 = 공급자가 청소 담당(폴백) */}
        <option value="">{t("unassigned")}</option>
        {cleaners.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.phone ? ` (${c.phone})` : ""}
          </option>
        ))}
      </select>

      {cleaners.length === 0 && (
        <p className="mt-2 text-xs text-amber-400">{t("noCleaners")}</p>
      )}

      <div className="mt-2 min-h-[16px] text-xs">
        {saving && <span className="text-slate-400">{t("saving")}</span>}
        {saved && <span className="font-medium text-green-500">{saved}</span>}
        {error && <span className="font-medium text-red-500">{t("errSave")}</span>}
      </div>
    </CollapsibleCard>
  );
}
