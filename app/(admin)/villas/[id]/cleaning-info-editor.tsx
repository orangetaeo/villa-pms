"use client";

// 빌라 청소직원용 운영정보 편집기 (T-cleaner-features C·D) — ADMIN 빌라 상세 전용.
//   주소·출입정보(도어코드/키)·청소 특이사항 → PATCH /api/villas/[id]/cleaning-info.
//   배정된 청소직원이 빌라에 가서·들어가서·주의해서 청소하도록 전달하는 정보(게스트 비공개).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import CollapsibleCard from "@/components/admin/collapsible-card";

export default function CleaningInfoEditor({
  villaId,
  initialAddress,
  initialAccessInfo,
  initialCleaningNotes,
}: {
  villaId: string;
  initialAddress: string | null;
  initialAccessInfo: string | null;
  initialCleaningNotes: string | null;
}) {
  const t = useTranslations("adminVillas.detail.cleaningInfo");
  const router = useRouter();
  const [address, setAddress] = useState(initialAddress ?? "");
  const [accessInfo, setAccessInfo] = useState(initialAccessInfo ?? "");
  const [cleaningNotes, setCleaningNotes] = useState(initialCleaningNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  async function onSave() {
    setSaving(true);
    setError(false);
    setSaved(false);
    try {
      const res = await fetch(`/api/villas/${villaId}/cleaning-info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: address.trim() || null,
          accessInfo: accessInfo.trim() || null,
          cleaningNotes: cleaningNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-admin-primary focus:outline-none";

  return (
    <CollapsibleCard title={t("title")} icon="cleaning_services">
      <p className="text-xs text-admin-muted mb-3">{t("desc")}</p>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-400">{t("address")}</span>
          <input
            type="text"
            value={address}
            maxLength={300}
            onChange={(e) => {
              setAddress(e.target.value);
              setSaved(false);
            }}
            placeholder={t("addressPlaceholder")}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-400">{t("access")}</span>
          <textarea
            value={accessInfo}
            maxLength={1000}
            rows={2}
            onChange={(e) => {
              setAccessInfo(e.target.value);
              setSaved(false);
            }}
            placeholder={t("accessPlaceholder")}
            className={`${inputClass} resize-none`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-400">{t("notes")}</span>
          <textarea
            value={cleaningNotes}
            maxLength={2000}
            rows={3}
            onChange={(e) => {
              setCleaningNotes(e.target.value);
              setSaved(false);
            }}
            placeholder={t("notesPlaceholder")}
            className={`${inputClass} resize-none`}
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-admin-primary px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? t("saving") : t("save")}
        </button>
        {saved && <span className="text-xs font-medium text-green-500">{t("saved")}</span>}
        {error && <span className="text-xs font-medium text-red-500">{t("errSave")}</span>}
      </div>
    </CollapsibleCard>
  );
}
