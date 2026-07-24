"use client";

// 입금 계좌·연락처 설정 — BANK_NAME·BANK_ACCOUNT_NUMBER·BANK_ACCOUNT_HOLDER·
// CONTACT_KAKAO_URL·CONTACT_PHONE (T1.7-bank-contact, Stitch b8 Card 3 변환)
// 공개 제안 완료/만료 페이지의 입금 안내·문의 버튼에 노출되는 값.
// 단일 저장 버튼 → 배치 PUT(entries). 빈 값 = 미설정(삭제).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// 클라이언트 검증 — 서버(route.ts VALIDATORS)와 동일 규칙, 빈 값 허용(선택 입력)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: "tooLong" });

const accountNumberField = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[0-9][0-9\- ]{0,39}$/.test(v), { message: "format" });

const bankFormSchema = z.object({
  bankName: optionalText(100),
  accountNumber: accountNumberField,
  accountHolder: optionalText(100),
  vnBankName: optionalText(100),
  vnAccountNumber: accountNumberField,
  vnAccountHolder: optionalText(100),
  kakaoUrl: z
    .string()
    .trim()
    .refine(
      (v) => {
        if (v === "") return true;
        if (v.length > 300) return false;
        try {
          const u = new URL(v);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "url" }
    ),
  zaloUrl: z
    .string()
    .trim()
    .refine(
      (v) => {
        if (v === "") return true;
        if (v.length > 300) return false;
        try {
          const u = new URL(v);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "url" }
    ),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[0-9+(][0-9+\-() ]{0,29}$/.test(v), { message: "format" }),
});

type BankFormValues = z.infer<typeof bankFormSchema>;

export type BankContactInitial = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  vnBankName: string;
  vnAccountNumber: string;
  vnAccountHolder: string;
  kakaoUrl: string;
  zaloUrl: string;
  phone: string;
};

const FIELD_TO_KEY: Record<keyof BankFormValues, string> = {
  bankName: "BANK_NAME",
  accountNumber: "BANK_ACCOUNT_NUMBER",
  accountHolder: "BANK_ACCOUNT_HOLDER",
  vnBankName: "BANK_VN_NAME",
  vnAccountNumber: "BANK_VN_ACCOUNT_NUMBER",
  vnAccountHolder: "BANK_VN_ACCOUNT_HOLDER",
  kakaoUrl: "CONTACT_KAKAO_URL",
  zaloUrl: "CONTACT_ZALO_URL",
  phone: "CONTACT_PHONE",
};

export default function BankContactForm({ initial }: { initial: BankContactInitial }) {
  const t = useTranslations("adminSettings.bank");
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<BankFormValues>({
    resolver: zodResolver(bankFormSchema),
    defaultValues: initial,
  });

  const onSubmit = async (values: BankFormValues) => {
    setMessage(null);
    const entries = (Object.keys(FIELD_TO_KEY) as (keyof BankFormValues)[]).map((field) => ({
      key: FIELD_TO_KEY[field],
      value: values[field].trim(),
    }));
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("error") });
    }
  };

  const inputClass =
    "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary";

  return (
    <section className="bg-admin-card rounded-xl border border-slate-800 shadow-lg flex flex-col">
      {/* 카드 헤더 (b8 Card 3) */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">account_balance</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("title")}
          </h2>
        </div>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-8">
        {/* 한국(KRW) 계좌 — KRW 예약 입금처 */}
        <fieldset className="space-y-4">
          <legend className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
            <span className="text-base">🇰🇷</span>
            {t("krSection")}
          </legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field
              id="bank-name"
              label={t("bankName")}
              error={errors.bankName ? t(`err.${errors.bankName.message}`) : null}
            >
              <input id="bank-name" type="text" className={inputClass} {...register("bankName")} />
            </Field>
            <Field
              id="bank-account-number"
              label={t("accountNumber")}
              error={errors.accountNumber ? t(`err.${errors.accountNumber.message}`) : null}
            >
              <input
                id="bank-account-number"
                type="text"
                inputMode="numeric"
                className={`${inputClass} tabular-nums`}
                {...register("accountNumber")}
              />
            </Field>
            <Field
              id="bank-account-holder"
              label={t("accountHolder")}
              error={errors.accountHolder ? t(`err.${errors.accountHolder.message}`) : null}
            >
              <input
                id="bank-account-holder"
                type="text"
                className={inputClass}
                {...register("accountHolder")}
              />
            </Field>
          </div>
        </fieldset>

        {/* 베트남(VND) 계좌 — VND 예약 입금처 */}
        <fieldset className="space-y-4 pt-2 border-t border-slate-800">
          <legend className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
            <span className="text-base">🇻🇳</span>
            {t("vnSection")}
          </legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field
              id="vn-bank-name"
              label={t("bankName")}
              error={errors.vnBankName ? t(`err.${errors.vnBankName.message}`) : null}
            >
              <input
                id="vn-bank-name"
                type="text"
                className={inputClass}
                {...register("vnBankName")}
              />
            </Field>
            <Field
              id="vn-bank-account-number"
              label={t("accountNumber")}
              error={errors.vnAccountNumber ? t(`err.${errors.vnAccountNumber.message}`) : null}
            >
              <input
                id="vn-bank-account-number"
                type="text"
                inputMode="numeric"
                className={`${inputClass} tabular-nums`}
                {...register("vnAccountNumber")}
              />
            </Field>
            <Field
              id="vn-bank-account-holder"
              label={t("accountHolder")}
              error={errors.vnAccountHolder ? t(`err.${errors.vnAccountHolder.message}`) : null}
            >
              <input
                id="vn-bank-account-holder"
                type="text"
                className={inputClass}
                {...register("vnAccountHolder")}
              />
            </Field>
          </div>
        </fieldset>

        {/* 공용 연락처 */}
        <fieldset className="space-y-4 pt-2 border-t border-slate-800">
          <legend className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            {t("contactSection")}
          </legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field
              id="contact-phone"
              label={t("phone")}
              error={errors.phone ? t(`err.${errors.phone.message}`) : null}
            >
              <input
                id="contact-phone"
                type="text"
                inputMode="tel"
                className={`${inputClass} tabular-nums`}
                {...register("phone")}
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                id="contact-kakao-url"
                label={t("kakaoUrl")}
                error={errors.kakaoUrl ? t(`err.${errors.kakaoUrl.message}`) : null}
              >
                <input
                  id="contact-kakao-url"
                  type="url"
                  placeholder="https://open.kakao.com/o/..."
                  className={inputClass}
                  {...register("kakaoUrl")}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field
                id="contact-zalo-url"
                label={t("zaloUrl")}
                error={errors.zaloUrl ? t(`err.${errors.zaloUrl.message}`) : null}
              >
                <input
                  id="contact-zalo-url"
                  type="url"
                  placeholder="https://zalo.me/0791234567"
                  className={inputClass}
                  {...register("zaloUrl")}
                />
              </Field>
            </div>
          </div>
        </fieldset>
        {/* 푸터: 안내 + 저장 (b8 카드 패턴) */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-4 border-t border-slate-800">
          <p className="text-xs text-slate-500">{t("hint")}</p>
          <div className="flex items-center gap-3 self-end md:self-auto">
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
        </div>
      </form>
    </section>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-xs font-bold text-slate-400 uppercase tracking-wider"
      >
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
