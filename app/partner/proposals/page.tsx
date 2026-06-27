// app/partner/proposals/page.tsx — 파트너가 받은 제안서 (ADR-0028 PP3)
//   Role=PARTNER 전용. 자기 partnerId 스코프(loadPartnerProposals). 상세는 /p/[token] 공개 링크로 위임.
//   ★ 누수: 제안서 빌라 상세·가격은 노출 안 함(개수만). 상세 열람은 공개 링크(별 탭).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerProposals } from "@/lib/partner-portal";
import PaginationBar from "@/components/pagination-bar";
import { parsePageParams } from "@/lib/pagination";
import { formatDate } from "../_format";

export const metadata: Metadata = {
  title: "받은 제안서 — Villa Go",
};

const PROPOSAL_STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-teal-100 text-teal-700",
  USED: "bg-emerald-100 text-emerald-700",
  EXPIRED: "bg-neutral-100 text-neutral-500",
  REVOKED: "bg-neutral-100 text-neutral-400 line-through",
};

export default async function PartnerProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARTNER") redirect("/login");

  const partner = await getPartnerForUser(session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") redirect("/partner");

  const t = await getTranslations("partner");
  // 자기 partnerId 스코프 제안서(서버 스코프 유지) — 표시 슬라이스만 추가
  const proposals = await loadPartnerProposals(partner.id);

  // 페이지네이션 — 받은 제안서는 누적되어 늘어나는 목록. URL page/pageSize 기준 메모리 슬라이스(라이트 테마).
  const params = await searchParams;
  const { page, pageSize, skip, take } = parsePageParams(params);
  const pagedProposals = proposals.slice(skip, skip + take);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold text-neutral-900">{t("proposals.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t("proposals.subtitle")}</p>
      </header>

      {proposals.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-10 text-center shadow-sm">
          <span className="material-symbols-outlined text-5xl text-teal-600">
            description
          </span>
          <p className="text-sm font-bold text-neutral-700">{t("proposals.empty")}</p>
          <p className="text-sm text-neutral-500">{t("proposals.emptyHint")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {pagedProposals.map((p) => (
            <li key={p.token}>
              <a
                href={`/p/${p.token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm transition-transform active:scale-[0.99]"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-bold text-neutral-900">
                    {t("proposals.villaCount", { count: p.itemCount })}
                  </p>
                  <p className="text-sm text-neutral-500">
                    {t("proposals.expires", { date: formatDate(p.expiresAt) })}
                  </p>
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                      PROPOSAL_STATUS_STYLE[p.status] ?? "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {t(`proposalStatus.${p.status}`)}
                  </span>
                </div>
                <span className="material-symbols-outlined shrink-0 text-neutral-400">
                  open_in_new
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(라이트 테마) */}
      <PaginationBar total={proposals.length} page={page} pageSize={pageSize} light />
    </div>
  );
}
