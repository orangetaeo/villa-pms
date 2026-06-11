"use client";

// 예약 설정 — 가예약 기본 유지 시간 (T1.7, Stitch b8 스테퍼 변환)
// AppSetting HOLD_HOURS_DEFAULT (1~168 정수) → PUT /api/settings
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const MIN_HOURS = 1;
const MAX_HOURS = 168;

const holdFormSchema = z.object({
  hours: z.number().int().min(MIN_HOURS).max(MAX_HOURS),
});

type HoldFormValues = z.infer<typeof holdFormSchema>;

export default function HoldHoursForm({ initialHours }: { initialHours: number }) {
  const t = useTranslations("adminSettings.hold");
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const {
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting, isDirty },
  } = useForm<HoldFormValues>({
    resolver: zodResolver(holdFormSchema),
    defaultValues: { hours: initialHours },
  });

  const hours = watch("hours");

  const step = (delta: number) => {
    const next = Math.min(MAX_HOURS, Math.max(MIN_HOURS, hours + delta));
    setValue("hours", next, { shouldDirty: true });
  };

  const onSubmit = async (values: HoldFormValues) => {
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "HOLD_HOURS_DEFAULT", value: String(values.hours) }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("error") });
    }
  };

  return (
    <section className="bg-admin-card rounded-xl border border-slate-800 shadow-lg flex flex-col">
      {/* 카드 헤더 (b8) */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">pending_actions</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("title")}
          </h2>
        </div>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <span className="block text-sm font-bold text-slate-200">{t("label")}</span>
            <p className="text-sm text-slate-400">{t("description")}</p>
          </div>
          {/* 스테퍼 (b8) — 1~168 클램프 */}
          <div className="flex items-center">
            <div className="flex items-center bg-slate-900 rounded-lg p-1 border border-slate-700">
              <button
                type="button"
                aria-label={t("decrease")}
                disabled={hours <= MIN_HOURS}
                onClick={() => step(-1)}
                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-all disabled:opacity-40"
              >
                <span className="material-symbols-outlined">remove</span>
              </button>
              <div className="px-6 flex items-baseline gap-1">
                <span className="text-xl font-bold text-white tabular-nums">{hours}</span>
                <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
                  {t("unit")}
                </span>
              </div>
              <button
                type="button"
                aria-label={t("increase")}
                disabled={hours >= MAX_HOURS}
                onClick={() => step(1)}
                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-all disabled:opacity-40"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>
          </div>
        </div>
        {/* 구분선 + 저장 (b8) */}
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
            type="submit"
            disabled={isSubmitting || !isDirty}
            className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-lg font-bold text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-lg">save</span>
            {isSubmitting ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </section>
  );
}
