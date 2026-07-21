// /contracts — 사업 계약서 관리 (운영자, T-business-contract-esign). 다크·ko. canViewFinance.
//   미들웨어 FINANCE_PATHS에 /contracts 등록 + 사이드바 "계약"(cap: canViewFinance).
//   RSC: prisma 직접 조회((admin) 레이아웃 운영자 가드 하). 목록 + 신규 생성 폼.
//   ★ 누수: termsJson 원시값·마진·판매가 미조회. 상태·상대·타입만 목록에 표시.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { readContractPartyADefaults } from "@/lib/business-contract";
import ContractCreateForm, { type ContractCandidate } from "./contract-create-form";
import PartyASettingsForm from "./party-a-settings-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContracts");
  return { title: `${t("title")} — Villa Go` };
}

const COUNTERPART_ROLES = ["SUPPLIER", "VENDOR", "PARTNER"] as const;

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-slate-700/40 text-slate-300",
  SENT: "bg-amber-500/15 text-amber-300",
  SIGNED: "bg-emerald-500/15 text-emerald-300",
  VOID: "bg-red-500/15 text-red-300",
};

function fmt(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/-/g, ".");
}

export default async function AdminContractsPage() {
  const t = await getTranslations("adminContracts");

  // 계약 목록 — 관계 미설정 모델이라 counterpart User는 별도 조회로 join.
  const rows = await prisma.businessContract.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      type: true,
      counterpartId: true,
      status: true,
      locale: true,
      signedAt: true,
      createdAt: true,
    },
  });
  const ids = [...new Set(rows.map((r) => r.counterpartId))];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  // 계약 대상 후보 — 활성 SUPPLIER/VENDOR/PARTNER 계정(중복 계약 가드는 생성 API가 담당).
  const candidateRows = await prisma.user.findMany({
    where: { role: { in: [...COUNTERPART_ROLES] }, isActive: true, deletedAt: null },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, role: true },
  });
  const candidates: ContractCandidate[] = candidateRows.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role as ContractCandidate["role"],
  }));

  // 갑(회사) 계약 주체 고정값 — 생성 폼 prefill(재입력 방지). 부재 시 빈 객체 → 수동 입력.
  const partyADefaults = await readContractPartyADefaults(prisma);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-1 text-sm text-admin-muted">{t("subtitle")}</p>
      </header>

      <PartyASettingsForm defaults={partyADefaults} />

      <ContractCreateForm candidates={candidates} defaults={partyADefaults} />

      <section className="overflow-hidden rounded-xl border border-slate-800 bg-admin-card shadow-lg">
        <div className="border-b border-slate-800 bg-slate-800/30 px-6 py-4">
          <h2 className="font-bold uppercase tracking-wide text-slate-100">{t("list.heading")}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">{t("list.counterpart")}</th>
                <th className="px-6 py-3">{t("list.type")}</th>
                <th className="px-6 py-3">{t("list.status")}</th>
                <th className="px-6 py-3">{t("list.signedAt")}</th>
                <th className="px-6 py-3">{t("list.createdAt")}</th>
                <th className="px-6 py-3 text-right">{t("list.view")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-admin-muted">
                    {t("list.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="group transition-colors hover:bg-slate-800/40">
                    <td className="px-6 py-4 text-sm font-semibold text-slate-100">
                      {nameById.get(r.counterpartId) ?? "—"}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">{t(`type.${r.type}`)}</td>
                    <td className="px-6 py-4">
                      <span
                        className={
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-bold " +
                          (STATUS_TONE[r.status] ?? "bg-slate-700/40 text-slate-300")
                        }
                      >
                        {t(`status.${r.status}`)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm tabular-nums text-slate-400">
                      {fmt(r.signedAt)}
                    </td>
                    <td className="px-6 py-4 text-sm tabular-nums text-slate-400">
                      {fmt(r.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/contracts/${r.id}`}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-admin-primary hover:underline"
                      >
                        {t("list.view")}
                        <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
