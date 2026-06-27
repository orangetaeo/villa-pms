import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { formatVnd } from "@/lib/format";
import { getReceivablesOverview, isOverLimit } from "@/lib/partner-server";
import ReceivablesTable, { type ReceivableRow } from "./receivables-table";

// 미수/여신 대시보드 (ADR-0022 PARTNER-3) — 전 파트너 미수 Aging·연체·한도초과. 재무 전용.
// RSC가 KPI·Aging 합산(전 파트너 기준)을 그리고, 금액은 서버에서 formatVnd로 문자열화.
// 파트너별 목록만 클라 래퍼(ReceivablesTable)로 분리해 페이지네이션(controlled slice).
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

  // 클라 페이지네이션 표에 넘길 표시 전용 행 — BigInt·Partner 전체 객체는 넘기지 않는다
  // (직렬화 차단 + 채권 외 필드 누수 차단, 원칙2). 금액은 여기서 formatVnd로 문자열화.
  const tableRows: ReceivableRow[] = overview.partners.map((a) => ({
    partnerId: a.partner.id,
    partnerName: a.partner.name,
    typeLabel: tp(`types.${a.partner.type}`),
    tierLabel: tp(`tierShort.${a.partner.creditTier}`),
    outstandingLabel: formatVnd(a.outstandingVnd),
    overdue: a.overdue,
    over30Label: a.aging["30+"] > 0n ? formatVnd(a.aging["30+"]) : null,
    overLimit: isOverLimit(a),
  }));

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

      {/* 파트너별 미수 — 클라 페이지네이션 래퍼(controlled slice + PaginationBar) */}
      <ReceivablesTable rows={tableRows} />
    </div>
  );
}
