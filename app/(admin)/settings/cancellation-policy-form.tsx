"use client";

// 취소·환불 정책 설정 (#6b → T-guest-policy-tiers S3) — **N단계 가변** 편집 + 표시 토글.
// AppSetting CANCELLATION_POLICY(JSON) → PUT /api/settings(단일 키). 공개 제안 페이지가 소비.
//
// S3 추가:
//  · 단계 추가·삭제(2~8행). 마지막 행은 노쇼·체크인 후 고정(-1), 0 = 체크인 당일.
//  · 「공급자 계약과 맞추기」 프리셋 — 계약 별표2(5단계)와 back-to-back인 환불표로 한 번에 전환.
//  · ★ 정합성 경고 — 공급자 지급률이 고객 위약금률(100−환불률)을 넘는 구간이 있으면 회사가 손실을 본다.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CANCELLATION_POLICY_KEY,
  POLICY_MAX_ROWS,
  SUPPLIER_ALIGNED_TIERS,
  isValidCancellationPolicy,
  serializeCancellationPolicy,
  type CancellationPolicy,
  type GuestRefundTier,
} from "@/lib/cancellation-policy";
import { DEFAULT_CANCEL_TIERS } from "@/lib/cancel-tiers";
import { findLossWindows } from "@/lib/cancellation-breakdown";

export default function CancellationPolicyForm({ initial }: { initial: CancellationPolicy }) {
  const t = useTranslations("adminSettings.cancellationPolicy");
  const router = useRouter();
  const [tiers, setTiers] = useState<GuestRefundTier[]>(() => initial.tiers.map((x) => ({ ...x })));
  const [enabled, setEnabled] = useState(initial.enabled);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const policy: CancellationPolicy = { tiers, enabled };
  const valid = isValidCancellationPolicy(policy);
  const lastIndex = tiers.length - 1;

  // ★ 공급자 계약 기본 단계표(별표2 프리셋) 대비 손실 구간. 계약별 값이 다를 수 있으나
  //   기본 프리셋과의 정합만 봐도 "고객 정책이 계약보다 후한지"가 드러난다.
  const lossWindows = useMemo(
    () => (valid ? findLossWindows(tiers, DEFAULT_CANCEL_TIERS) : []),
    [tiers, valid],
  );

  const touch = () => {
    setDirty(true);
    setMessage(null);
  };

  const setRow = (i: number, patch: Partial<GuestRefundTier>) => {
    setTiers((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    touch();
  };

  const addRow = () => {
    if (tiers.length >= POLICY_MAX_ROWS) return;
    setTiers((prev) => {
      const above = prev[prev.length - 2];
      const next = [...prev];
      next.splice(prev.length - 1, 0, {
        fromDays: Math.max(0, (above?.fromDays ?? 1) - 1),
        refundPct: above?.refundPct ?? 50,
      });
      return next;
    });
    touch();
  };

  const removeRow = (i: number) => {
    if (tiers.length <= 2 || i === lastIndex) return;
    setTiers((prev) => prev.filter((_, k) => k !== i));
    touch();
  };

  const applyPreset = () => {
    setTiers(SUPPLIER_ALIGNED_TIERS.map((x) => ({ ...x })));
    touch();
  };

  const onSave = async () => {
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
              touch();
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

        {/* 단계 표 */}
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="bg-slate-900/60 text-xs text-slate-400">
                <th className="px-3 py-2 text-left font-medium">{t("colWhen")}</th>
                <th className="w-32 px-2 py-2 text-right font-medium">{t("colDays")}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{t("colRefund")}</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {tiers.map((row, i) => {
                const isLast = i === lastIndex;
                return (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="px-3 py-2 text-slate-300">
                      {isLast
                        ? t("rowNoShow")
                        : row.fromDays === 0
                          ? t("rowSameDay")
                          : t("rowRange", { days: row.fromDays })}
                    </td>
                    <td className="px-2 py-1.5">
                      {isLast ? (
                        <span className="block text-right text-xs text-slate-500">—</span>
                      ) : (
                        <NumberInput
                          value={row.fromDays}
                          onChange={(e) =>
                            setRow(i, {
                              fromDays:
                                e.target.value === "" ? Number.NaN : Number.parseInt(e.target.value, 10),
                            })
                          }
                          min={0}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput
                        value={row.refundPct}
                        onChange={(e) =>
                          setRow(i, {
                            refundPct:
                              e.target.value === "" ? Number.NaN : Number.parseInt(e.target.value, 10),
                          })
                        }
                        min={0}
                        max={100}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {!isLast && tiers.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          aria-label={t("rowRemove")}
                          className="text-slate-500 transition-colors hover:text-red-400"
                        >
                          <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addRow}
            disabled={tiers.length >= POLICY_MAX_ROWS}
            className="h-8 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            {t("addRow")}
          </button>
          <button
            type="button"
            onClick={applyPreset}
            className="h-8 rounded-lg border border-admin-primary/50 px-3 text-xs font-bold text-blue-300 transition-colors hover:bg-blue-500/10"
          >
            {t("applyPreset")}
          </button>
        </div>

        {!valid && <p className="text-xs text-red-400">{t("invalid")}</p>}

        {/* ★ 정합성 경고 — 공급자 계약 기본 단계표 대비 회사가 손실을 보는 구간 */}
        {lossWindows.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold text-amber-300">
              <span className="material-symbols-outlined text-base">warning</span>
              {t("lossTitle")}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-amber-200/90">
              {lossWindows.map((w) => (
                <li key={w.daysBefore}>
                  {t("lossRow", {
                    days: w.daysBefore,
                    refund: w.guestRefundPct,
                    pay: w.supplierPayPct,
                    loss: w.lossPct,
                  })}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-200/70">{t("lossHint")}</p>
          </div>
        )}

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
      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-right text-sm text-slate-100 tabular-nums focus:border-admin-primary focus:outline-none"
    />
  );
}
