import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { formatVnd } from "@/lib/format";
import {
  getReceivablesOverview,
  isOverLimit,
  type PartnerAggregate,
} from "@/lib/partner-server";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";

// 미수/여신 대시보드 (ADR-0022 PARTNER-3) — 전 파트너 미수 Aging·연체·한도초과. 재무 전용.
// 순수 RSC(클라이언트 컴포넌트 없음) — 금액은 서버에서 formatVnd로 문자열화.
export default async function ReceivablesPage() {
  const session = await auth();
  if (!session?.user?.id || !canViewFinance(session.user.role)) {
    redirect("/login");
  }

  const t = await getTranslations("adminReceivables");
  const tp = await getTranslations("adminPartners");
  const overview = await getReceivablesOverview(prisma, new Date());

  const kpis = [
    { label: t("kpi.totalOutstanding"), value: formatVnd(overview.totalOutstandingVnd), danger: false },
    { label: t("kpi.overdueOutstanding"), value: formatVnd(overview.overdueOutstandingVnd), danger: overview.overdueOutstandingVnd > 0n },
    { label: t("kpi.overduePartners"), value: String(overview.overduePartnerCount), danger: overview.overduePartnerCount > 0 },
    { label: t("kpi.overLimit"), value: String(overview.overLimitPartnerCount), danger: overview.overLimitPartnerCount > 0 },
  ];

  const agingCells: Array<{ key: keyof typeof overview.aging; label: string; danger?: boolean }> = [
    { key: "0-7", label: tp("aging.0-7") },
    { key: "8-15", label: tp("aging.8-15"), danger: true },
    { key: "16-30", label: tp("aging.16-30"), danger: true },
    { key: "30+", label: tp("aging.30+"), danger: true },
  ];

  const columns: ResponsiveColumn<PartnerAggregate>[] = [
    {
      key: "name",
      header: tp("col.name"),
      cell: (a) => (
        <Link href={`/partners/${a.partner.id}`} className="font-bold text-white hover:text-admin-primary">
          {a.partner.name}
          <span className="block text-[11px] font-normal text-slate-500">
            {tp(`types.${a.partner.type}`)} · {tp(`tierShort.${a.partner.creditTier}`)}
          </span>
        </Link>
      ),
    },
    {
      key: "outstanding",
      header: tp("col.outstanding"),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (a) => (
        <span className={a.overdue ? "font-bold text-red-400" : "text-slate-200"}>
          {formatVnd(a.outstandingVnd)}
        </span>
      ),
    },
    {
      key: "30+",
      header: tp("aging.30+"),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (a) =>
        a.aging["30+"] > 0n ? (
          <span className="text-red-400">{formatVnd(a.aging["30+"])}</span>
        ) : (
          <span className="text-slate-600">—</span>
        ),
    },
    {
      key: "alerts",
      header: t("alerts"),
      cell: (a) => (
        <div className="flex flex-wrap gap-1">
          {a.overdue && (
            <span className="inline-block rounded px-2 py-0.5 text-[10px] font-bold bg-red-500/15 text-red-300">
              {tp("overdue")}
            </span>
          )}
          {isOverLimit(a) && (
            <span className="inline-block rounded px-2 py-0.5 text-[10px] font-bold bg-amber-500/15 text-amber-300">
              {t("overLimitBadge")}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-black text-white">{t("title")}</h1>
        <p className="text-sm text-admin-muted mt-1">{t("subtitle")}</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-800 bg-admin-card p-4">
            <p className="text-[11px] font-bold uppercase text-slate-500">{k.label}</p>
            <p className={`mt-1 text-lg font-black tabular-nums ${k.danger ? "text-red-400" : "text-white"}`}>
              {k.value}
            </p>
          </div>
        ))}
      </div>

      {/* Aging 합산 */}
      <div className="rounded-xl border border-slate-800 bg-admin-card p-4">
        <h2 className="mb-3 text-xs font-bold uppercase text-slate-500">{t("agingTitle")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {agingCells.map((c) => (
            <div key={c.key}>
              <p className="text-[11px] font-bold uppercase text-slate-500">{c.label}</p>
              <p
                className={`mt-1 text-sm font-bold tabular-nums ${
                  c.danger && overview.aging[c.key] > 0n ? "text-red-400" : "text-slate-300"
                }`}
              >
                {formatVnd(overview.aging[c.key])}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 파트너별 미수 */}
      <ResponsiveTable
        columns={columns}
        rows={overview.partners}
        rowKey={(a) => a.partner.id}
        emptyMessage={t("empty")}
        cardSummary={(a) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-white">{a.partner.name}</span>
            <span className={`text-xs ${a.overdue ? "text-red-400 font-bold" : "text-slate-400"}`}>
              {formatVnd(a.outstandingVnd)}
              {a.overdue ? ` · ${tp("overdue")}` : ""}
            </span>
          </div>
        )}
      />
    </div>
  );
}
