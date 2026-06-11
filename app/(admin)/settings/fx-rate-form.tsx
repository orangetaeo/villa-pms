"use client";

// 환율 설정 — FX_VND_PER_KRW (T1.7, 계약 범위 — b8 카드 스타일 준용)
// 1 KRW = x VND 수동 입력. lib/pricing 파서 호환: /^\d+(\.\d{1,4})?$/ 양수
// 마지막 수정 시각은 RSC에서 AppSetting.updatedAt 포맷 후 문자열로 전달
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const fxFormSchema = z.object({
  rate: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/)
    .refine((v) => Number(v) > 0),
});

type FxFormValues = z.infer<typeof fxFormSchema>;

export default function FxRateForm({
  initialValue,
  updatedAtText,
}: {
  initialValue: string | null;
  updatedAtText: string | null;
}) {
  const t = useTranslations("adminSettings.fx");
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<FxFormValues>({
    resolver: zodResolver(fxFormSchema),
    defaultValues: { rate: initialValue ?? "" },
  });

  const onSubmit = async (values: FxFormValues) => {
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "FX_VND_PER_KRW", value: values.rate.trim() }),
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
      {/* 카드 헤더 (b8 스타일) */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">currency_exchange</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("title")}
          </h2>
        </div>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <label htmlFor="fx-rate" className="block text-sm font-bold text-slate-200">
              {t("label")}
            </label>
            <p className="text-sm text-slate-400">{t("description")}</p>
            {/* 마지막 수정 시각 (AppSetting.updatedAt) */}
            <p className="text-xs text-slate-500 pt-1 whitespace-nowrap tabular-nums">
              {updatedAtText ? t("lastUpdated", { time: updatedAtText }) : t("notSet")}
            </p>
          </div>
          {/* 입력 그룹: 1 KRW = [x] VND */}
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2 bg-slate-900 rounded-lg p-1 pl-4 border border-slate-700">
              <span className="text-sm font-medium text-slate-400 whitespace-nowrap">
                {t("prefix")}
              </span>
              <input
                id="fx-rate"
                type="text"
                inputMode="decimal"
                placeholder={t("placeholder")}
                {...register("rate")}
                className="w-28 h-10 bg-transparent border-none text-right text-xl font-bold text-white tabular-nums placeholder:text-slate-600 placeholder:text-sm placeholder:font-normal focus:ring-0"
              />
              <span className="text-xs text-slate-500 font-medium pr-3 whitespace-nowrap">
                {t("suffix")}
              </span>
            </div>
            {errors.rate && (
              <p role="alert" className="text-xs text-red-400">
                {t("invalid")}
              </p>
            )}
          </div>
        </div>
        {/* 구분선 + 저장 (b8 카드 패턴) */}
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
