"use client";

// 취소·환불 정책 설정 (#6b) — 고정 3단계(전액/부분/불가)의 숫자만 편집 + 표시 토글.
// AppSetting CANCELLATION_POLICY(JSON) → PUT /api/settings(단일 키). 공개 제안 페이지가 소비.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CANCELLATION_POLICY_KEY,
  serializeCancellationPolicy,
  type CancellationPolicy,
} from "@/lib/cancellation-policy";

export default function CancellationPolicyForm({ initial }: { initial: CancellationPolicy }) {
  const t = useTranslations("adminSettings.cancellationPolicy");
  const router = useRouter();
  const [fullDays, setFullDays] = useState(initial.fullDays);
  const [partialDays, setPartialDays] = useState(initial.partialDays);
  const [partialPct, setPartialPct] = useState(initial.partialPct);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 정합성: 전액일 > 부분일 ≥ 0, 0 ≤ 부분율 ≤ 100 (서버 검증과 동일)
  const valid =
    Number.isInteger(fullDays) &&
    Number.isInteger(partialDays) &&
    Number.isInteger(partialPct) &&
    fullDays > partialDays &&
    partialDays >= 0 &&
    partialPct >= 0 &&
    partialPct <= 100;

  const num = (setter: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value === "" ? Number.NaN : Number.parseInt(e.target.value, 10));
    setDirty(true);
    setMessage(null);
  };

  const onSave = async () => {
    const policy: CancellationPolicy = { fullDays, partialDays, partialPct, enabled };
    const value = serializeCancellationPolicy(policy);
    if (!value) {
      setMessage({ ok: false, text: t("invalid") });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: CANCELLATION_POLICY_KEY, value }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
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
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">event_busy</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("title")}
          </h2>
        </div>
        {/* 표시 토글 */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs font-medium text-slate-400">{t("enabledLabel")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => {
              setEnabled((v) => !v);
              setDirty(true);
              setMessage(null);
            }}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              enabled ? "bg-admin-primary" : "bg-slate-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                enabled ? "translate-x-5" : ""
              }`}
            />
          </button>
        </label>
      </div>

      <div className="p-6 md:p-8 space-y-6">
        <p className="text-sm text-slate-400">{t("description")}</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t("fullDaysLabel")} suffix={t("daysUnit")}>
            <NumberInput value={fullDays} onChange={num(setFullDays)} min={1} />
          </Field>
          <Field label={t("partialDaysLabel")} suffix={t("daysUnit")}>
            <NumberInput value={partialDays} onChange={num(setPartialDays)} min={0} />
          </Field>
          <Field label={t("partialPctLabel")} suffix="%">
            <NumberInput value={partialPct} onChange={num(setPartialPct)} min={0} max={100} />
          </Field>
        </div>

        {/* 미리보기 — 공개 페이지에 보일 3단계 문구 */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-1.5">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">
            {t("preview")}
          </p>
          {valid ? (
            <ul className="text-xs text-slate-300 space-y-1">
              <li>· {t("lineFull", { days: fullDays })}</li>
              <li>· {t("linePartial", { days: partialDays, pct: partialPct })}</li>
              <li>· {t("lineNone", { days: partialDays })}</li>
            </ul>
          ) : (
            <p className="text-xs text-red-400">{t("invalid")}</p>
          )}
        </div>

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
            disabled={saving || !dirty || !valid}
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

function Field({
  label,
  suffix,
  children,
}: {
  label: string;
  suffix: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-bold text-slate-300">{label}</label>
      <div className="flex items-center gap-2">
        {children}
        <span className="text-sm text-slate-500 whitespace-nowrap">{suffix}</span>
      </div>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={Number.isNaN(value) ? "" : value}
      onChange={onChange}
      min={min}
      max={max}
      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 tabular-nums focus:border-admin-primary focus:outline-none"
    />
  );
}
