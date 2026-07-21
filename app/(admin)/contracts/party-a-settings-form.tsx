"use client";

// 계약 주체(갑, Bên A) 고정 정보 편집 (T-business-contract-esign) — 다크 ADMIN. react-hook-form + zod.
//   AppSetting BUSINESS_CONTRACT_PARTY_A(JSON) 4개 필드 편집 → PUT /api/admin/business-contracts/party-a.
//   저장 성공 시 router.refresh() → 하단 신규 계약 생성 폼도 새 값으로 재prefill.
//   ★ 원가·마진·판매가 없음. 갑(회사) 신원 정보만.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// 자유텍스트 "{{" 금지(BE containsTemplateInjection 대칭 — 클라 즉시 피드백).
const noBraces = (s: string): boolean => !s.includes("{{");

const schema = z.object({
  companyName: z.string().trim().min(1).max(200).refine(noBraces),
  companyPassport: z.string().trim().min(1).max(60).refine(noBraces),
  companyContactVn: z.string().trim().min(1).max(60).refine(noBraces),
  companyContactKr: z.string().trim().max(60).refine(noBraces).optional().or(z.literal("")),
});

type FormValues = z.input<typeof schema>;

export interface PartyADefaults {
  companyName?: string;
  companyPassport?: string;
  companyContactVn?: string;
  companyContactKr?: string;
}

export default function PartyASettingsForm({ defaults }: { defaults?: PartyADefaults }) {
  const t = useTranslations("adminContracts");
  const router = useRouter();
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { isSubmitting, errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      companyName: defaults?.companyName ?? "",
      companyPassport: defaults?.companyPassport ?? "",
      companyContactVn: defaults?.companyContactVn ?? "",
      companyContactKr: defaults?.companyContactKr ?? "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSaved(false);
    const payload = {
      companyName: values.companyName.trim(),
      companyPassport: values.companyPassport.trim(),
      companyContactVn: values.companyContactVn.trim(),
      companyContactKr: values.companyContactKr?.trim() ?? "",
    };
    try {
      const res = await fetch("/api/admin/business-contracts/party-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh(); // 생성 폼도 새 값으로 재prefill
        return;
      }
      setError("root", { message: t("partyA.error") });
    } catch {
      setError("root", { message: t("partyA.error") });
    }
  };

  const inputClass =
    "h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 [color-scheme:dark] placeholder:text-slate-600";
  const labelClass = "mb-1.5 block text-xs font-medium text-slate-400";

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-xl border border-slate-800 bg-admin-card p-6 shadow-lg"
    >
      <div>
        <h2 className="flex items-center gap-2 font-bold text-slate-100">
          <span className="material-symbols-outlined text-admin-primary">badge</span>
          {t("partyA.heading")}
        </h2>
        <p className="mt-1.5 text-xs text-admin-muted">{t("partyA.description")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t("create.companyName")}</span>
          <input type="text" {...register("companyName")} className={inputClass} />
          {errors.companyName && (
            <span className="mt-1 block text-xs text-red-400">{t("partyA.invalid")}</span>
          )}
        </label>
        <label className="block">
          <span className={labelClass}>{t("create.companyPassport")}</span>
          <input type="text" {...register("companyPassport")} className={inputClass} />
          {errors.companyPassport && (
            <span className="mt-1 block text-xs text-red-400">{t("partyA.invalid")}</span>
          )}
        </label>
        <label className="block">
          <span className={labelClass}>{t("create.companyContactVn")}</span>
          <input type="text" {...register("companyContactVn")} className={inputClass} />
          {errors.companyContactVn && (
            <span className="mt-1 block text-xs text-red-400">{t("partyA.invalid")}</span>
          )}
        </label>
        <label className="block">
          <span className={labelClass}>{t("create.companyContactKr")}</span>
          <input type="text" {...register("companyContactKr")} className={inputClass} />
          {errors.companyContactKr && (
            <span className="mt-1 block text-xs text-red-400">{t("partyA.invalid")}</span>
          )}
        </label>
      </div>

      {errors.root && <p className="text-xs text-red-400">{errors.root.message}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex h-10 items-center gap-2 rounded-lg bg-admin-primary px-6 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-lg">save</span>
          {isSubmitting ? t("partyA.saving") : t("partyA.save")}
        </button>
        {saved && !isDirty && (
          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            {t("partyA.saved")}
          </span>
        )}
      </div>
    </form>
  );
}
