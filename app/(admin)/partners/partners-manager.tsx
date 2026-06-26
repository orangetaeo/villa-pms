"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";
import { formatVnd } from "@/lib/format";
import PartnerForm, { type PartnerFormValues } from "./partner-form";

export interface SerializedPartnerAggregate {
  partner: {
    id: string;
    type: "TRAVEL_AGENCY" | "LAND_AGENCY";
    name: string;
    nameVi: string | null;
    creditTier: "A" | "B" | "C";
    creditLimitVnd: string;
    depositRatePct: number;
    paymentTermDays: number;
    status: "ACTIVE" | "SUSPENDED" | "BLOCKED";
    contactPhone: string | null;
  };
  outstandingVnd: string;
  aging: { "0-7": string; "8-15": string; "16-30": string; "30+": string; total: string };
  overdue: boolean;
  bookingCount: number;
}

const TIER_BADGE: Record<string, string> = {
  A: "bg-slate-700 text-slate-200",
  B: "bg-amber-500/20 text-amber-300",
  C: "bg-purple-500/20 text-purple-300",
};
const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-300",
  SUSPENDED: "bg-amber-500/15 text-amber-300",
  BLOCKED: "bg-red-500/15 text-red-300",
};

export default function PartnersManager({
  partners,
}: {
  partners: SerializedPartnerAggregate[];
}) {
  const t = useTranslations("adminPartners");
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (values: PartnerFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          billingCycle: values.billingCycle || null,
        }),
      });
      if (!res.ok) {
        setError(t("saveFailed"));
        setSubmitting(false);
        return;
      }
      setShowCreate(false);
      setSubmitting(false);
      router.refresh();
    } catch {
      setError(t("saveFailed"));
      setSubmitting(false);
    }
  };

  const columns: ResponsiveColumn<SerializedPartnerAggregate>[] = [
    {
      key: "name",
      header: t("col.name"),
      cell: (r) => (
        <Link href={`/partners/${r.partner.id}`} className="font-bold text-white hover:text-admin-primary">
          {r.partner.name}
          {r.partner.nameVi && (
            <span className="block text-[11px] font-normal text-slate-500">{r.partner.nameVi}</span>
          )}
        </Link>
      ),
    },
    {
      key: "type",
      header: t("col.type"),
      cell: (r) => (
        <span className="text-slate-300">{t(`types.${r.partner.type}`)}</span>
      ),
    },
    {
      key: "tier",
      header: t("col.tier"),
      cell: (r) => (
        <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${TIER_BADGE[r.partner.creditTier]}`}>
          {t(`tierShort.${r.partner.creditTier}`)}
        </span>
      ),
    },
    {
      key: "outstanding",
      header: t("col.outstanding"),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (r) => (
        <span className={r.overdue ? "font-bold text-red-400" : "text-slate-200"}>
          {formatVnd(r.outstandingVnd)}
          {r.overdue && (
            <span className="ml-1 align-middle text-[10px] font-bold text-red-400">● {t("overdue")}</span>
          )}
        </span>
      ),
    },
    {
      key: "limit",
      header: t("col.creditLimit"),
      className: "text-right tabular-nums text-slate-400",
      headerClassName: "text-right",
      cell: (r) =>
        r.partner.creditTier === "A" ? (
          <span className="text-slate-600">—</span>
        ) : (
          formatVnd(r.partner.creditLimitVnd)
        ),
    },
    {
      key: "status",
      header: t("col.status"),
      cell: (r) => (
        <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[r.partner.status]}`}>
          {t(`statuses.${r.partner.status}`)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">{t("title")}</h1>
          <p className="text-sm text-admin-muted mt-1">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowCreate(true);
          }}
          className="shrink-0 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white"
        >
          + {t("new")}
        </button>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={partners}
        rowKey={(r) => r.partner.id}
        emptyMessage={t("empty")}
        cardSummary={(r) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-white">{r.partner.name}</span>
            <span className="text-xs text-slate-400">
              {t(`types.${r.partner.type}`)} · {t(`tierShort.${r.partner.creditTier}`)} ·{" "}
              <span className={r.overdue ? "text-red-400 font-bold" : ""}>{formatVnd(r.outstandingVnd)}</span>
            </span>
          </div>
        )}
        cardFooter={(r) => (
          <Link
            href={`/partners/${r.partner.id}`}
            className="mt-1 inline-block text-xs font-bold text-admin-primary"
          >
            {t("viewDetail")} →
          </Link>
        )}
      />

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          onClick={() => !submitting && setShowCreate(false)}
        >
          <div
            className="my-8 w-full max-w-2xl rounded-2xl border border-slate-800 bg-admin-bg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-white">{t("createTitle")}</h2>
            <PartnerForm
              mode="create"
              submitting={submitting}
              error={error}
              onSubmit={create}
              onCancel={() => !submitting && setShowCreate(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
