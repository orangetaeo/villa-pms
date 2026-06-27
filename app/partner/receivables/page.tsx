// app/partner/receivables/page.tsx — 파트너 미수(채권·청구서) (ADR-0028 PP3)
//   Role=PARTNER 전용. 자기 partnerId 스코프(loadPartnerReceivables).
//   ★ 누수: 여기 금액은 전부 파트너에게 청구되는 VND(채권·청구서)뿐 — 정당. KRW·원가·마진 없음.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerReceivables } from "@/lib/partner-portal";
import { formatVndDot } from "../_format";
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
