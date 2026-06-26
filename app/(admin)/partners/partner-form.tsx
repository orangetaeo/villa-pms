"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PARTNER_COUNTRIES } from "@/lib/partner-country";

export interface PartnerFormValues {
  type: "TRAVEL_AGENCY" | "LAND_AGENCY";
  name: string;
  nameVi: string;
  contactPhone: string;
  contactZaloUid: string;
  contactEmail: string;
  /** ISO alpha-2 국가 코드 — 청구서 PDF 언어 결정. "" = 미지정 */
  country: string;
  creditTier: "A" | "B" | "C";
  creditLimitVnd: string; // digits
  depositRatePct: number;
  paymentTermDays: number;
  billingCycle: "" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  status: "ACTIVE" | "SUSPENDED" | "BLOCKED";
  memo: string;
}

export const EMPTY_PARTNER: PartnerFormValues = {
  type: "TRAVEL_AGENCY",
  name: "",
  nameVi: "",
  contactPhone: "",
  contactZaloUid: "",
  contactEmail: "",
  country: "",
  creditTier: "A",
  creditLimitVnd: "0",
  depositRatePct: 30,
  paymentTermDays: 0,
  billingCycle: "",
  status: "ACTIVE",
  memo: "",
};

const inputCls =
  "w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:border-admin-primary focus:outline-none";
const labelCls = "text-[11px] font-bold text-slate-400 uppercase";

export default function PartnerForm({
  mode,
  initial,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: PartnerFormValues;
  submitting: boolean;
  error?: string | null;
  onSubmit: (values: PartnerFormValues) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("adminPartners");
  const [v, setV] = useState<PartnerFormValues>(initial ?? EMPTY_PARTNER);
  const set = <K extends keyof PartnerFormValues>(k: K, val: PartnerFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  // 등급 A(선불)는 여신 없음 → 신용한도·결제주기 비활성(시각적 안내)
  const creditDisabled = v.creditTier === "A";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("form.type")}</span>
          <select
            className={inputCls}
            value={v.type}
            disabled={mode === "edit"}
            onChange={(e) => set("type", e.target.value as PartnerFormValues["type"])}
          >
            <option value="TRAVEL_AGENCY">{t("types.TRAVEL_AGENCY")}</option>
            <option value="LAND_AGENCY">{t("types.LAND_AGENCY")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("form.status")}</span>
          <select
            className={inputCls}
            value={v.status}
            onChange={(e) => set("status", e.target.value as PartnerFormValues["status"])}
          >
            <option value="ACTIVE">{t("statuses.ACTIVE")}</option>
            <option value="SUSPENDED">{t("statuses.SUSPENDED")}</option>
            <option value="BLOCKED">{t("statuses.BLOCKED")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("form.name")}</span>
          <input
            className={inputCls}
            value={v.name}
            required
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("form.nameVi")}</span>
          <input
            className={inputCls}
            value={v.nameVi}
            onChange={(e) => set("nameVi", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("form.contactPhone")}</span>
          <input
            className={inputCls}
            value={v.contactPhone}
            onChange={(e) => set("contactPhone", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("form.contactZalo")}</span>
          <input
            className={inputCls}
            value={v.contactZaloUid}
            onChange={(e) => set("contactZaloUid", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("form.contactEmail")}</span>
          <input
            className={inputCls}
            type="email"
            value={v.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
          />
        </label>
        {/* 국가 — 청구서 PDF 출력 언어를 결정(KR=한국어·VN=베트남어·그 외=영어) */}
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t("form.country")}</span>
          <select
            className={inputCls}
            value={v.country}
            onChange={(e) => set("country", e.target.value)}
          >
            <option value="">{t("countries.none")}</option>
            {PARTNER_COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {t(`countries.${code}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 신용·결제 조건 */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex flex-col gap-4">
        <p className="text-xs text-slate-400">{t("creditSectionHint")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>{t("form.creditTier")}</span>
            <select
              className={inputCls}
              value={v.creditTier}
              onChange={(e) => set("creditTier", e.target.value as PartnerFormValues["creditTier"])}
            >
              <option value="A">{t("tiers.A")}</option>
              <option value="B">{t("tiers.B")}</option>
              <option value="C">{t("tiers.C")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>{t("form.depositRate")}</span>
            <input
              className={inputCls}
              type="number"
              min={0}
              max={100}
              value={v.depositRatePct}
              onChange={(e) => set("depositRatePct", Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>{t("form.creditLimit")}</span>
            <input
              className={inputCls}
              inputMode="numeric"
              value={v.creditLimitVnd}
              disabled={creditDisabled}
              onChange={(e) => set("creditLimitVnd", e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>{t("form.paymentTermDays")}</span>
            <input
              className={inputCls}
              type="number"
              min={0}
              max={365}
              value={v.paymentTermDays}
              disabled={creditDisabled}
              onChange={(e) => set("paymentTermDays", Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={labelCls}>{t("form.billingCycle")}</span>
            <select
              className={inputCls}
              value={v.billingCycle}
              disabled={creditDisabled}
              onChange={(e) =>
                set("billingCycle", e.target.value as PartnerFormValues["billingCycle"])
              }
            >
              <option value="">{t("cycles.NONE")}</option>
              <option value="WEEKLY">{t("cycles.WEEKLY")}</option>
              <option value="BIWEEKLY">{t("cycles.BIWEEKLY")}</option>
              <option value="MONTHLY">{t("cycles.MONTHLY")}</option>
            </select>
          </label>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelCls}>{t("form.memo")}</span>
        <textarea
          className={`${inputCls} min-h-[64px]`}
          value={v.memo}
          onChange={(e) => set("memo", e.target.value)}
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {submitting ? t("saving") : mode === "create" ? t("create") : t("save")}
        </button>
      </div>
    </form>
  );
}
