// app/partner/receivables/page.tsx — 파트너 미수(채권·청구서) (ADR-0028 PP3)
//   Role=PARTNER 전용. 자기 partnerId 스코프(loadPartnerReceivables).
//   ★ 누수: 여기 금액은 전부 파트너에게 청구되는 VND(채권·청구서)뿐 — 정당. KRW·원가·마진 없음.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerReceivables } from "@/lib/partner-portal";
import { formatVndComma } from "../_format";
import ReceivablesList from "./receivables-list";
import InvoicesList from "./invoices-list";

export const metadata: Metadata = {
  title: "미수 현황 — Villa Go",
};

export default async function PartnerReceivablesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARTNER") redirect("/login");

  const partner = await getPartnerForUser(session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") redirect("/partner");

  const t = await getTranslations("partner");
  const { receivables, invoices, summary, stats } = await loadPartnerReceivables(partner.id);
  const hasOverdue = BigInt(stats.overdueVnd) > 0n;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-neutral-900">{t("receivables.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t("receivables.subtitle")}</p>
      </header>

      {/* 요약 카드 — 미수잔액 강조 */}
      <section className="relative overflow-hidden rounded-2xl bg-teal-600 p-6 text-white shadow-xl">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-teal-500 opacity-20" />
        <div className="relative z-10 space-y-4">
          <div>
            <p className="text-sm font-medium text-teal-50 opacity-90">
              {t("receivables.outstanding")}
            </p>
            <h2 className="mt-1 text-4xl font-extrabold tracking-tight">
              {formatVndComma(summary.outstandingVnd)}
            </h2>
          </div>
          <div className="h-px w-full bg-white/20" />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-teal-50">
            <div>
              <span className="opacity-80">{t("receivables.totalBilled")}: </span>
              {formatVndComma(summary.totalBilledVnd)}
            </div>
            <div>
              <span className="opacity-80">{t("receivables.totalPaid")}: </span>
              {formatVndComma(summary.totalPaidVnd)}
            </div>
          </div>
        </div>
      </section>

      {/* 통계 — 미연체/연체 + 연체 구간(aging). 연체가 있으면 강조 */}
      <section className="space-y-3 rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-neutral-700">
          <span className="material-symbols-outlined text-[18px] text-teal-600">monitoring</span>
          {t("receivables.statsTitle")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-[11px] font-medium text-slate-500">{t("receivables.statNotDue")}</p>
            <p className="mt-0.5 text-sm font-extrabold tabular-nums text-slate-800">
              {formatVndComma(stats.notDueVnd)}
            </p>
          </div>
          <div className={`rounded-xl p-3 text-center ${hasOverdue ? "bg-rose-50" : "bg-slate-50"}`}>
            <p className={`text-[11px] font-medium ${hasOverdue ? "text-rose-600" : "text-slate-400"}`}>
              {t("receivables.statOverdue", { count: stats.overdueCount })}
            </p>
            <p
              className={`mt-0.5 text-sm font-extrabold tabular-nums ${
                hasOverdue ? "text-rose-700" : "text-slate-500"
              }`}
            >
              {formatVndComma(stats.overdueVnd)}
            </p>
          </div>
        </div>
        {/* 연체 구간 (연체 있을 때만) */}
        {hasOverdue && (
          <div className="grid grid-cols-3 gap-2">
            <AgingCell label={t("receivables.agingD1_7")} value={formatVndComma(stats.aging.d1_7)} />
            <AgingCell label={t("receivables.agingD8_30")} value={formatVndComma(stats.aging.d8_30)} />
            <AgingCell label={t("receivables.agingD30plus")} value={formatVndComma(stats.aging.d30plus)} strong />
          </div>
        )}
      </section>

      {/* 채권 목록 — controlled 페이지네이션(라이트) 클라 래퍼 */}
      <section className="space-y-3">
        <h3 className="text-lg font-bold text-neutral-800">
          {t("receivables.listTitle")}
        </h3>
        <ReceivablesList receivables={receivables} />
      </section>

      {/* 청구서 목록 — controlled 페이지네이션(라이트) 클라 래퍼 */}
      <section className="space-y-3">
        <h3 className="text-lg font-bold text-neutral-800">
          {t("receivables.invoiceTitle")}
        </h3>
        <InvoicesList invoices={invoices} />
      </section>
    </div>
  );
}

/** 연체 구간 한 칸 — 라벨 + 금액(30일+는 강조). */
function AgingCell({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-2.5 text-center ${strong ? "border-rose-200 bg-rose-50" : "border-neutral-100 bg-white"}`}>
      <p className="text-[10px] font-medium text-neutral-400">{label}</p>
      <p className={`mt-0.5 text-xs font-bold tabular-nums ${strong ? "text-rose-700" : "text-neutral-700"}`}>
        {value}
      </p>
    </div>
  );
}
