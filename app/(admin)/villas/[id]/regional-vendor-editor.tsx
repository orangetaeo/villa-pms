"use client";

// 빌라 지역 지정 업체 (ADR-0037) — ADMIN 빌라 상세 전용.
//   마사지·이발은 지역 분포 업체라 이 빌라에서 가까운 샵을 지정한다. 미지정이면 카탈로그 기본 업체로 발주.
//   지정·해제는 즉시 PUT. cleaner-assign-editor 패턴(행별 select → 저장).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import CollapsibleCard from "@/components/admin/collapsible-card";

// 지역 분포 타입 — lib/regional-vendor.REGIONAL_VENDOR_TYPES와 동기(클라 상수 중복 최소화, 2행 UI 고정).
const REGIONAL_TYPES = ["MASSAGE", "BARBER"] as const;
type RegionalType = (typeof REGIONAL_TYPES)[number];

export interface RegionalVendorOption {
  id: string;
  name: string;
}

export default function RegionalVendorEditor({
  villaId,
  vendors,
  initial,
}: {
  villaId: string;
  vendors: RegionalVendorOption[];
  initial: Record<RegionalType, string | null>;
}) {
  const t = useTranslations("adminVillas.detail.regionalVendor");
  const router = useRouter();
  const [values, setValues] = useState<Record<RegionalType, string>>({
    MASSAGE: initial.MASSAGE ?? "",
    BARBER: initial.BARBER ?? "",
  });
  const [savingType, setSavingType] = useState<RegionalType | null>(null);
  const [savedType, setSavedType] = useState<RegionalType | null>(null);
  const [errorType, setErrorType] = useState<RegionalType | null>(null);

  async function save(serviceType: RegionalType, nextId: string) {
    setSavingType(serviceType);
    setSavedType(null);
    setErrorType(null);
    try {
      const res = await fetch(`/api/villas/${villaId}/service-vendors`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceType, vendorId: nextId || null }),
      });
      if (!res.ok) {
        setErrorType(serviceType);
        return;
      }
      setSavedType(serviceType);
      router.refresh();
    } catch {
      setErrorType(serviceType);
    } finally {
      setSavingType(null);
    }
  }

  return (
    <CollapsibleCard title={t("title")} icon="storefront" defaultOpen>
      <p className="text-xs text-admin-muted mb-3">{t("desc")}</p>

      <div className="space-y-4">
        {REGIONAL_TYPES.map((type) => (
          <div key={type}>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              {t(`types.${type}`)}
            </label>
            <select
              value={values[type]}
              disabled={savingType === type}
              onChange={(e) => {
                const next = e.target.value;
                setValues((v) => ({ ...v, [type]: next }));
                void save(type, next);
              }}
              className="w-full rounded-lg bg-slate-900/60 border border-slate-700 px-3 py-2 text-sm text-white focus:border-admin-primary focus:outline-none disabled:opacity-50"
            >
              {/* 미지정 = 카탈로그 기본 업체로 폴백 */}
              <option value="">{t("unassigned")}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <div className="mt-1 min-h-[16px] text-xs">
              {savingType === type && <span className="text-slate-400">{t("saving")}</span>}
              {savedType === type && <span className="font-medium text-green-500">{t("saved")}</span>}
              {errorType === type && <span className="font-medium text-red-500">{t("errSave")}</span>}
            </div>
          </div>
        ))}
      </div>

      {vendors.length === 0 && <p className="mt-2 text-xs text-amber-400">{t("noVendors")}</p>}
    </CollapsibleCard>
  );
}
