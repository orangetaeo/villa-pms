"use client";

// 신규 계약서 작성 폼 (T-business-contract-esign) — 다크 ADMIN. react-hook-form + zod.
//   상대 선택 → role로 계약 타입 자동 결정 → 타입별 별표(신원·정산주기 등) 폼.
//   ★ termsJson에 원가·마진·판매가 필드 없음(BE zod .strict가 거부). 신원·정산 조건만.
//   POST /api/admin/business-contracts → 201이면 목록 새로고침. 409=중복 안내.
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

export interface ContractCandidate {
  id: string;
  name: string;
  role: "SUPPLIER" | "VENDOR" | "PARTNER";
}

type ContractType = "VILLA_SUPPLY" | "SERVICE_VENDOR" | "PARTNER_AGENCY";

// 로그인 role → 계약 타입(클라 인라인 — lib/business-contract는 node:fs 의존이라 클라 import 금지).
const ROLE_TO_TYPE: Record<ContractCandidate["role"], ContractType> = {
  SUPPLIER: "VILLA_SUPPLY",
  VENDOR: "SERVICE_VENDOR",
  PARTNER: "PARTNER_AGENCY",
};

const schema = z
  .object({
    counterpartId: z.string().min(1),
    type: z.enum(["VILLA_SUPPLY", "SERVICE_VENDOR", "PARTNER_AGENCY"]),
    locale: z.enum(["ko", "vi"]),
    companyName: z.string().trim().min(1).max(200),
    companyPassport: z.string().trim().min(1).max(60),
    companyContactVn: z.string().max(60).optional(),
    companyContactKr: z.string().max(60).optional(),
    bankName: z.string().max(100).optional(),
    accountNumber: z.string().max(60).optional(),
    accountHolder: z.string().max(100).optional(),
    specialTerms: z.string().max(4000).optional(),
    cancelFreeDays: z.coerce.number().int().min(0).max(365).optional(),
    cancelPartialPct: z.coerce.number().int().min(0).max(100).optional(),
    payMethod: z.enum(["CASH", "BANK"]).optional(),
    settleCycle: z.enum(["MONTHLY", "WEEKLY", "PER_ORDER"]).optional(),
    settleDetail: z.string().max(200).optional(),
    partnerCompany: z.string().max(200).optional(),
    partnerBizNo: z.string().max(60).optional(),
    partnerRep: z.string().max(120).optional(),
    partnerContact: z.string().max(120).optional(),
  })
  .superRefine((d, ctx) => {
    const req = (path: keyof typeof d) =>
      ctx.addIssue({ path: [path], code: z.ZodIssueCode.custom, message: "required" });
    if (!d.companyContactVn?.trim()) req("companyContactVn"); // 베트남 연락처=전 타입 필수(BE requiredText 대칭)
    if (d.type === "VILLA_SUPPLY") {
      if (!d.payMethod) req("payMethod");
    } else if (d.type === "SERVICE_VENDOR") {
      if (!d.payMethod) req("payMethod");
      if (!d.settleCycle) req("settleCycle");
    } else if (d.type === "PARTNER_AGENCY") {
      if (!d.partnerCompany?.trim()) req("partnerCompany");
      if (!d.partnerRep?.trim()) req("partnerRep");
      if (!d.partnerContact?.trim()) req("partnerContact");
    }
  });

type FormValues = z.input<typeof schema>;

export interface ContractPartyADefaults {
  companyName?: string;
  companyPassport?: string;
  companyContactVn?: string;
  companyContactKr?: string;
}

export default function ContractCreateForm({
  candidates,
  defaults,
}: {
  candidates: ContractCandidate[];
  defaults?: ContractPartyADefaults;
}) {
  const t = useTranslations("adminContracts");
  const router = useRouter();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      counterpartId: "",
      type: "VILLA_SUPPLY",
      locale: "vi",
      companyName: defaults?.companyName ?? "",
      companyPassport: defaults?.companyPassport ?? "",
      companyContactVn: defaults?.companyContactVn ?? "",
      companyContactKr: defaults?.companyContactKr ?? "",
    },
  });

  const counterpartId = watch("counterpartId");
  const type = watch("type");

  const candidateById = useMemo(
    () => new Map(candidates.map((c) => [c.id, c])),
    [candidates],
  );

  // 상대 변경 → 타입 자동 결정. 파트너는 ko 정본만 → locale ko 강제.
  const onCounterpartChange = (id: string) => {
    setValue("counterpartId", id, { shouldValidate: true });
    const c = candidateById.get(id);
    const nextType = c ? ROLE_TO_TYPE[c.role] : "VILLA_SUPPLY";
    setValue("type", nextType);
    if (nextType === "PARTNER_AGENCY") setValue("locale", "ko");
  };

  const onSubmit = async (values: FormValues) => {
    const v = values as z.output<typeof schema>;
    // 타입별 termsJson 조립 — 해당 타입 필드만(BE .strict가 잉여 키 거부).
    const common: Record<string, unknown> = {
      companyName: v.companyName.trim(),
      companyPassport: v.companyPassport.trim(),
      companyContactVn: v.companyContactVn?.trim() ?? "", // 필수(BE requiredText)
    };
    if (v.companyContactKr?.trim()) common.companyContactKr = v.companyContactKr.trim();
    // 계좌 정보 — 은행명·계좌번호·예금주 3필드. 값 있는 항목만 담고, 전부 비면 키 자체를 생략.
    const bank: Record<string, string> = {};
    if (v.bankName?.trim()) bank.bankName = v.bankName.trim();
    if (v.accountNumber?.trim()) bank.accountNumber = v.accountNumber.trim();
    if (v.accountHolder?.trim()) bank.accountHolder = v.accountHolder.trim();
    if (Object.keys(bank).length > 0) common.bankInfo = bank;
    if (v.specialTerms?.trim()) common.specialTerms = v.specialTerms.trim();

    let terms: Record<string, unknown>;
    if (v.type === "VILLA_SUPPLY") {
      terms = {
        ...common,
        cancelFreeDays: v.cancelFreeDays ?? 14,
        cancelPartialPct: v.cancelPartialPct ?? 50,
        payMethod: v.payMethod,
      };
    } else if (v.type === "SERVICE_VENDOR") {
      terms = { ...common, settleCycle: v.settleCycle, payMethod: v.payMethod };
      if (v.settleDetail?.trim()) terms.settleDetail = v.settleDetail.trim();
    } else {
      terms = {
        ...common,
        partnerCompany: v.partnerCompany?.trim(),
        partnerRep: v.partnerRep?.trim(),
        partnerContact: v.partnerContact?.trim(),
      };
      if (v.partnerBizNo?.trim()) terms.partnerBizNo = v.partnerBizNo.trim();
    }

    try {
      const res = await fetch("/api/admin/business-contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counterpartId: v.counterpartId, locale: v.locale, terms }),
      });
      if (res.status === 201) {
        reset();
        router.refresh();
        return;
      }
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        setError("counterpartId", {
          message:
            data?.error === "SIGNED_CONTRACT_EXISTS"
              ? t("create.duplicateSigned")
              : t("create.duplicateActive"),
        });
        return;
      }
      setError("root", { message: t("create.error") });
    } catch {
      setError("root", { message: t("create.error") });
    }
  };

  const inputClass =
    "h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 [color-scheme:dark] placeholder:text-slate-600";
  const labelClass = "mb-1.5 block text-xs font-medium text-slate-400";
  const optLabel = t("create.optional");
  const isPartner = type === "PARTNER_AGENCY";

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-admin-card p-6 text-sm text-admin-muted">
        {t("create.noCandidates")}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-xl border border-slate-800 bg-admin-card p-6 shadow-lg"
    >
      <h2 className="flex items-center gap-2 font-bold text-slate-100">
        <span className="material-symbols-outlined text-admin-primary">note_add</span>
        {t("create.heading")}
      </h2>
      <p className="text-xs text-slate-500">
        <span className="text-red-400">*</span> {t("create.requiredHint")}
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 상대 */}
        <label className="block md:col-span-2">
          <span className={labelClass}>
            {t("create.counterpart")}
            <Req />
          </span>
          <select
            value={counterpartId}
            onChange={(e) => onCounterpartChange(e.target.value)}
            className={inputClass}
          >
            <option value="">{t("create.counterpartPlaceholder")}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {t(`type.${ROLE_TO_TYPE[c.role]}`)}
              </option>
            ))}
          </select>
          {errors.counterpartId && (
            <span className="mt-1 block text-xs text-red-400">
              {errors.counterpartId.message || t("create.invalid")}
            </span>
          )}
        </label>

        {/* 언어 — 파트너는 ko 고정 */}
        <label className="block">
          <span className={labelClass}>{t("create.locale")}</span>
          <select {...register("locale")} disabled={isPartner} className={inputClass}>
            <option value="vi">Tiếng Việt (vi)</option>
            <option value="ko">한국어 (ko)</option>
          </select>
        </label>
        <div className="hidden md:block" />

        {/* 공통 */}
        <label className="block">
          <span className={labelClass}>
            {t("create.companyName")}
            <Req />
          </span>
          <input type="text" {...register("companyName")} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>
            {t("create.companyPassport")}
            <Req />
          </span>
          <input type="text" {...register("companyPassport")} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>
            {t("create.companyContactVn")}
            <Req />
          </span>
          <input type="text" {...register("companyContactVn")} className={inputClass} />
          {errors.companyContactVn && (
            <span className="mt-1 block text-xs text-red-400">{t("create.invalid")}</span>
          )}
        </label>
        <label className="block">
          <span className={labelClass}>
            {t("create.companyContactKr")}
            <Opt label={optLabel} />
          </span>
          <input type="text" {...register("companyContactKr")} className={inputClass} />
        </label>

        {/* 빌라 공급 */}
        {type === "VILLA_SUPPLY" && (
          <>
            <label className="block">
              <span className={labelClass}>
                {t("create.cancelFreeDays")}
                <Opt label={optLabel} />
              </span>
              <input
                type="number"
                {...register("cancelFreeDays")}
                placeholder="14"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>
                {t("create.cancelPartialPct")}
                <Opt label={optLabel} />
              </span>
              <input
                type="number"
                {...register("cancelPartialPct")}
                placeholder="50"
                className={inputClass}
              />
            </label>
            <PayMethodSelect register={register} labelClass={labelClass} inputClass={inputClass} label={t("create.payMethod")} cashLabel={t("payMethod.CASH")} bankLabel={t("payMethod.BANK")} />
            <BankInfo
              register={register}
              labelClass={labelClass}
              inputClass={inputClass}
              optLabel={optLabel}
              bankNameLabel={t("create.bankName")}
              accountNumberLabel={t("create.accountNumber")}
              accountHolderLabel={t("create.accountHolder")}
            />
          </>
        )}

        {/* 부가서비스 업체 */}
        {type === "SERVICE_VENDOR" && (
          <>
            <label className="block">
              <span className={labelClass}>
                {t("create.settleCycle")}
                <Req />
              </span>
              <select {...register("settleCycle")} className={inputClass}>
                <option value="">—</option>
                <option value="MONTHLY">{t("settleCycle.MONTHLY")}</option>
                <option value="WEEKLY">{t("settleCycle.WEEKLY")}</option>
                <option value="PER_ORDER">{t("settleCycle.PER_ORDER")}</option>
              </select>
              {errors.settleCycle && (
                <span className="mt-1 block text-xs text-red-400">{t("create.invalid")}</span>
              )}
            </label>
            <label className="block">
              <span className={labelClass}>
                {t("create.settleDetail")}
                <Opt label={optLabel} />
              </span>
              <input type="text" {...register("settleDetail")} className={inputClass} />
            </label>
            <PayMethodSelect register={register} labelClass={labelClass} inputClass={inputClass} label={t("create.payMethod")} cashLabel={t("payMethod.CASH")} bankLabel={t("payMethod.BANK")} />
            <BankInfo
              register={register}
              labelClass={labelClass}
              inputClass={inputClass}
              optLabel={optLabel}
              bankNameLabel={t("create.bankName")}
              accountNumberLabel={t("create.accountNumber")}
              accountHolderLabel={t("create.accountHolder")}
            />
          </>
        )}

        {/* 파트너(여행사) */}
        {type === "PARTNER_AGENCY" && (
          <>
            <label className="block">
              <span className={labelClass}>
                {t("create.partnerCompany")}
                <Req />
              </span>
              <input type="text" {...register("partnerCompany")} className={inputClass} />
              {errors.partnerCompany && (
                <span className="mt-1 block text-xs text-red-400">{t("create.invalid")}</span>
              )}
            </label>
            <label className="block">
              <span className={labelClass}>
                {t("create.partnerBizNo")}
                <Opt label={optLabel} />
              </span>
              <input type="text" {...register("partnerBizNo")} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>
                {t("create.partnerRep")}
                <Req />
              </span>
              <input type="text" {...register("partnerRep")} className={inputClass} />
              {errors.partnerRep && (
                <span className="mt-1 block text-xs text-red-400">{t("create.invalid")}</span>
              )}
            </label>
            <label className="block">
              <span className={labelClass}>
                {t("create.partnerContact")}
                <Req />
              </span>
              <input type="text" {...register("partnerContact")} className={inputClass} />
              {errors.partnerContact && (
                <span className="mt-1 block text-xs text-red-400">{t("create.invalid")}</span>
              )}
            </label>
          </>
        )}

        {/* 특약 — 전 타입 공통 */}
        <label className="block md:col-span-2">
          <span className={labelClass}>
            {t("create.specialTerms")}
            <Opt label={optLabel} />
          </span>
          <textarea
            {...register("specialTerms")}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
          />
        </label>
      </div>

      {errors.root && <p className="text-xs text-red-400">{errors.root.message}</p>}

      <button
        type="submit"
        disabled={isSubmitting || !counterpartId}
        className="flex h-10 items-center gap-2 rounded-lg bg-admin-primary px-6 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-lg">add</span>
        {isSubmitting ? t("create.submitting") : t("create.submit")}
      </button>
    </form>
  );
}

type Register = UseFormRegister<FormValues>;

/** 필수 항목 마커(빨간 별표). */
function Req() {
  return (
    <span className="text-red-400" aria-hidden="true">
      {" *"}
    </span>
  );
}

/** 선택 항목 마커(회색 "· 선택"). label=현지화된 "선택" 단어. */
function Opt({ label }: { label: string }) {
  return <span className="ml-1 font-normal text-slate-500">· {label}</span>;
}

function PayMethodSelect({
  register,
  labelClass,
  inputClass,
  label,
  cashLabel,
  bankLabel,
}: {
  register: Register;
  labelClass: string;
  inputClass: string;
  label: string;
  cashLabel: string;
  bankLabel: string;
}) {
  return (
    <label className="block">
      <span className={labelClass}>
        {label}
        <Req />
      </span>
      <select {...register("payMethod")} className={inputClass}>
        <option value="">—</option>
        <option value="CASH">{cashLabel}</option>
        <option value="BANK">{bankLabel}</option>
      </select>
    </label>
  );
}

// 계좌 정보 — 은행명·계좌번호·예금주 3필드(모두 선택). 2열 그리드 흐름에 맞춰 개별 label로 배치.
function BankInfo({
  register,
  labelClass,
  inputClass,
  optLabel,
  bankNameLabel,
  accountNumberLabel,
  accountHolderLabel,
}: {
  register: Register;
  labelClass: string;
  inputClass: string;
  optLabel: string;
  bankNameLabel: string;
  accountNumberLabel: string;
  accountHolderLabel: string;
}) {
  return (
    <>
      <label className="block">
        <span className={labelClass}>
          {bankNameLabel}
          <Opt label={optLabel} />
        </span>
        <input type="text" {...register("bankName")} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>
          {accountNumberLabel}
          <Opt label={optLabel} />
        </span>
        <input type="text" inputMode="numeric" {...register("accountNumber")} className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>
          {accountHolderLabel}
          <Opt label={optLabel} />
        </span>
        <input type="text" {...register("accountHolder")} className={inputClass} />
      </label>
    </>
  );
}
