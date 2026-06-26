"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";
import { formatVnd, formatThousands } from "@/lib/format";
import PartnerForm, { type PartnerFormValues } from "../partner-form";

export interface SerializedPartnerDetail {
  partner: {
    id: string;
    type: "TRAVEL_AGENCY" | "LAND_AGENCY";
    name: string;
    nameVi: string | null;
    contactPhone: string | null;
    contactZaloUid: string | null;
    contactEmail: string | null;
    creditTier: "A" | "B" | "C";
    creditLimitVnd: string;
    depositRatePct: number;
    paymentTermDays: number;
    billingCycle: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null;
    status: "ACTIVE" | "SUSPENDED" | "BLOCKED";
    memo: string | null;
  };
  outstandingVnd: string;
  aging: { "0-7": string; "8-15": string; "16-30": string; "30+": string; total: string };
  overdue: boolean;
  bookingCount: number;
  receivables: Array<{
    id: string;
    bookingId: string;
    totalVnd: string;
    depositDueVnd: string;
    depositPaidVnd: string;
    balancePaidVnd: string;
    dueDate: string;
    status: string;
  }>;
  bookings: Array<{
    id: string;
    villaName: string;
    checkIn: string;
    checkOut: string;
    status: string;
    totalSaleVnd: string | null;
  }>;
}

const RECEIVABLE_BADGE: Record<string, string> = {
  PENDING: "bg-slate-700 text-slate-200",
  PARTIAL: "bg-amber-500/15 text-amber-300",
  PAID: "bg-emerald-500/15 text-emerald-300",
  OVERDUE: "bg-red-500/15 text-red-300",
  WRITTEN_OFF: "bg-slate-800 text-slate-500 line-through",
};

function fmtDate(iso: string) {
  return iso.slice(0, 10);
}

export default function PartnerDetailView({ detail }: { detail: SerializedPartnerDetail }) {
  const t = useTranslations("adminPartners");
  const router = useRouter();
  const p = detail.partner;
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial: PartnerFormValues = {
    type: p.type,
    name: p.name,
    nameVi: p.nameVi ?? "",
    contactPhone: p.contactPhone ?? "",
    contactZaloUid: p.contactZaloUid ?? "",
    contactEmail: p.contactEmail ?? "",
    creditTier: p.creditTier,
    creditLimitVnd: p.creditLimitVnd,
    depositRatePct: p.depositRatePct,
    paymentTermDays: p.paymentTermDays,
    billingCycle: p.billingCycle ?? "",
    status: p.status,
    memo: p.memo ?? "",
  };

  const save = async (values: PartnerFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/partners/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, billingCycle: values.billingCycle || null }),
      });
      if (!res.ok) {
        setError(t("saveFailed"));
        setSubmitting(false);
        return;
      }
      setEditing(false);
      setSubmitting(false);
      router.refresh();
    } catch {
      setError(t("saveFailed"));
      setSubmitting(false);
    }
  };

  const agingCells: Array<{ key: keyof typeof detail.aging; label: string; danger?: boolean }> = [
    { key: "0-7", label: t("aging.0-7") },
    { key: "8-15", label: t("aging.8-15"), danger: true },
    { key: "16-30", label: t("aging.16-30"), danger: true },
    { key: "30+", label: t("aging.30+"), danger: true },
  ];

  const receivableCols: ResponsiveColumn<SerializedPartnerDetail["receivables"][number]>[] = [
    {
      key: "due",
      header: t("rcv.dueDate"),
      cell: (r) => <span className="text-slate-300">{fmtDate(r.dueDate)}</span>,
    },
    {
      key: "total",
      header: t("rcv.total"),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (r) => formatVnd(r.totalVnd),
    },
    {
      key: "paid",
      header: t("rcv.paid"),
      className: "text-right tabular-nums text-slate-400",
      headerClassName: "text-right",
      cell: (r) => formatThousands((BigInt(r.depositPaidVnd) + BigInt(r.balancePaidVnd)).toString()),
    },
    {
      key: "status",
      header: t("rcv.status"),
      cell: (r) => (
        <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${RECEIVABLE_BADGE[r.status] ?? ""}`}>
          {t(`receivableStatus.${r.status}`)}
        </span>
      ),
    },
  ];

  const bookingCols: ResponsiveColumn<SerializedPartnerDetail["bookings"][number]>[] = [
    {
      key: "villa",
      header: t("bk.villa"),
      cell: (r) => (
        <Link href={`/bookings/${r.id}`} className="font-semibold text-white hover:text-admin-primary">
          {r.villaName}
        </Link>
      ),
    },
    {
      key: "stay",
      header: t("bk.stay"),
      cell: (r) => (
        <span className="text-slate-400">
          {fmtDate(r.checkIn)} ~ {fmtDate(r.checkOut)}
        </span>
      ),
    },
    {
      key: "total",
      header: t("bk.total"),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (r) => (r.totalSaleVnd ? formatVnd(r.totalSaleVnd) : <span className="text-slate-600">—</span>),
    },
    {
      key: "status",
      header: t("bk.status"),
      cell: (r) => <span className="text-slate-300">{r.status}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/partners" className="text-xs text-admin-muted hover:text-white">
            ← {t("title")}
          </Link>
          <h1 className="mt-1 text-2xl font-black text-white">{p.name}</h1>
          <p className="text-sm text-admin-muted">
            {t(`types.${p.type}`)} · {t(`tierShort.${p.creditTier}`)} · {t(`statuses.${p.status}`)}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800"
          >
            {t("edit")}
          </button>
        )}
      </div>

      {editing ? (
        <div className="rounded-2xl border border-slate-800 bg-admin-card p-6">
          <PartnerForm
            mode="edit"
            initial={initial}
            submitting={submitting}
            error={error}
            onSubmit={save}
            onCancel={() => !submitting && setEditing(false)}
          />
        </div>
      ) : (
        <>
          {/* 미수 요약 + Aging */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-slate-800 bg-admin-card p-4">
              <p className="text-[11px] font-bold uppercase text-slate-500">{t("outstanding")}</p>
              <p className={`mt-1 text-lg font-black ${detail.overdue ? "text-red-400" : "text-white"}`}>
                {formatVnd(detail.outstandingVnd)}
              </p>
            </div>
            {agingCells.map((c) => (
              <div key={c.key} className="rounded-xl border border-slate-800 bg-admin-card p-4">
                <p className="text-[11px] font-bold uppercase text-slate-500">{c.label}</p>
                <p
                  className={`mt-1 text-sm font-bold ${
                    c.danger && BigInt(detail.aging[c.key]) > 0n ? "text-red-400" : "text-slate-300"
                  }`}
                >
                  {formatVnd(detail.aging[c.key])}
                </p>
              </div>
            ))}
          </div>

          {/* 신용 조건 + 연락처 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-admin-card p-4 text-sm">
              <h3 className="mb-3 text-xs font-bold uppercase text-slate-500">{t("creditInfo")}</h3>
              <dl className="flex flex-col gap-2 text-slate-300">
                <Row label={t("form.creditTier")} value={t(`tiers.${p.creditTier}`)} />
                <Row
                  label={t("form.creditLimit")}
                  value={p.creditTier === "A" ? "—" : formatVnd(p.creditLimitVnd)}
                />
                <Row label={t("form.depositRate")} value={`${p.depositRatePct}%`} />
                <Row
                  label={t("form.paymentTermDays")}
                  value={p.creditTier === "A" ? t("prepaid") : `${p.paymentTermDays}${t("days")}`}
                />
                {p.billingCycle && (
                  <Row label={t("form.billingCycle")} value={t(`cycles.${p.billingCycle}`)} />
                )}
              </dl>
            </div>
            <div className="rounded-xl border border-slate-800 bg-admin-card p-4 text-sm">
              <h3 className="mb-3 text-xs font-bold uppercase text-slate-500">{t("contactInfo")}</h3>
              <dl className="flex flex-col gap-2 text-slate-300">
                {p.nameVi && <Row label={t("form.nameVi")} value={p.nameVi} />}
                <Row label={t("form.contactPhone")} value={p.contactPhone ?? "—"} />
                <Row label={t("form.contactZalo")} value={p.contactZaloUid ?? "—"} />
                <Row label={t("form.contactEmail")} value={p.contactEmail ?? "—"} />
              </dl>
              {p.memo && <p className="mt-3 whitespace-pre-wrap text-xs text-slate-400">{p.memo}</p>}
            </div>
          </div>

          {/* 미수 채권 목록 */}
          <section>
            <h3 className="mb-2 text-sm font-bold text-white">{t("receivablesTitle")}</h3>
            <ResponsiveTable
              columns={receivableCols}
              rows={detail.receivables}
              rowKey={(r) => r.id}
              emptyMessage={t("noReceivables")}
            />
          </section>

          {/* 예약 이력 */}
          <section>
            <h3 className="mb-2 text-sm font-bold text-white">
              {t("bookingsTitle")} ({detail.bookingCount})
            </h3>
            <ResponsiveTable
              columns={bookingCols}
              rows={detail.bookings}
              rowKey={(r) => r.id}
              emptyMessage={t("noBookings")}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[11px] font-bold uppercase text-slate-500">{label}</dt>
      <dd className="text-right text-slate-200">{value}</dd>
    </div>
  );
}
