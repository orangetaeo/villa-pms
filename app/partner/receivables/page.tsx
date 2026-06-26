// app/partner/receivables/page.tsx — 파트너 미수(채권·청구서) (ADR-0028 PP3)
//   Role=PARTNER 전용. 자기 partnerId 스코프(loadPartnerReceivables).
//   ★ 누수: 여기 금액은 전부 파트너에게 청구되는 VND(채권·청구서)뿐 — 정당. KRW·원가·마진 없음.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerReceivables } from "@/lib/partner-portal";
import { formatVillaName } from "@/lib/villa-name";
import { formatVndDot, formatDate, formatDayMonth } from "../_format";

export const metadata: Metadata = {
  title: "미수 현황 — Villa Go",
};

const RECEIVABLE_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  PARTIAL: "bg-blue-100 text-blue-700",
  PAID: "bg-emerald-100 text-emerald-700",
  OVERDUE: "bg-rose-100 text-rose-700",
  WRITTEN_OFF: "bg-neutral-100 text-neutral-500",
};

const INVOICE_STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-neutral-100 text-neutral-500",
  ISSUED: "bg-amber-100 text-amber-700",
  PARTIAL: "bg-blue-100 text-blue-700",
  PAID: "bg-emerald-100 text-emerald-700",
  OVERDUE: "bg-rose-100 text-rose-700",
  VOID: "bg-neutral-100 text-neutral-400 line-through",
};

export default async function PartnerReceivablesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARTNER") redirect("/login");

  const partner = await getPartnerForUser(session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") redirect("/partner");

  const t = await getTranslations("partner");
  const { receivables, invoices, summary } = await loadPartnerReceivables(partner.id);

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
              {formatVndDot(summary.outstandingVnd)}
            </h2>
          </div>
          <div className="h-px w-full bg-white/20" />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-teal-50">
            <div>
              <span className="opacity-80">{t("receivables.totalBilled")}: </span>
              {formatVndDot(summary.totalBilledVnd)}
            </div>
            <div>
              <span className="opacity-80">{t("receivables.totalPaid")}: </span>
              {formatVndDot(summary.totalPaidVnd)}
            </div>
          </div>
        </div>
      </section>

      {/* 채권 목록 */}
      <section className="space-y-3">
        <h3 className="text-lg font-bold text-neutral-800">
          {t("receivables.listTitle")}
        </h3>
        {receivables.length === 0 ? (
          <EmptyMini text={t("receivables.empty")} />
        ) : (
          <ul className="space-y-3">
            {receivables.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate font-bold text-neutral-900">
                      {formatVillaName({ name: r.villaName, nameVi: r.villaNameVi })}
                    </h4>
                    <p className="text-sm text-neutral-500">
                      {formatDayMonth(r.checkIn)} – {formatDayMonth(r.checkOut)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                      RECEIVABLE_STATUS_STYLE[r.status] ?? "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {t(`receivableStatus.${r.status}`)}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-neutral-100 pt-3 text-center">
                  <Field label={t("receivables.total")} value={formatVndDot(r.totalVnd)} />
                  <Field
                    label={t("receivables.paid")}
                    value={formatVndDot(
                      (BigInt(r.depositPaidVnd) + BigInt(r.balancePaidVnd)).toString()
                    )}
                  />
                  <Field
                    label={t("receivables.balance")}
                    value={formatVndDot(r.outstandingVnd)}
                    emphasis
                  />
                </dl>
                <p className="mt-2 text-right text-xs text-neutral-400">
                  {t("receivables.due", { date: formatDate(r.dueDate) })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 청구서 목록 */}
      <section className="space-y-3">
        <h3 className="text-lg font-bold text-neutral-800">
          {t("receivables.invoiceTitle")}
        </h3>
        {invoices.length === 0 ? (
          <EmptyMini text={t("receivables.invoiceEmpty")} />
        ) : (
          <ul className="space-y-3">
            {invoices.map((inv) => (
              <li
                key={inv.id}
                className="rounded-xl border border-neutral-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="font-bold text-neutral-900">
                      {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                    </h4>
                    <p className="text-sm text-neutral-500">
                      {t("receivables.due", { date: formatDate(inv.dueDate) })}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                      INVOICE_STATUS_STYLE[inv.status] ?? "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {t(`invoiceStatus.${inv.status}`)}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-neutral-100 pt-3 text-center">
                  <Field label={t("receivables.total")} value={formatVndDot(inv.totalVnd)} />
                  <Field label={t("receivables.paid")} value={formatVndDot(inv.paidVnd)} />
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </dt>
      <dd className={`text-sm font-bold ${emphasis ? "text-rose-600" : "text-neutral-800"}`}>
        {value}
      </dd>
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-200 bg-white p-6 text-center text-sm text-neutral-400">
      {text}
    </div>
  );
}
