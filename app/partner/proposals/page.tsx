// app/partner/proposals/page.tsx — 파트너가 받은 제안서 (ADR-0028 PP3 + T-partner-info 1)
//   Role=PARTNER 전용. 자기 partnerId 스코프(loadPartnerProposals).
//   포털 안에서 아이템(빌라·기간·제안가·예약상태)까지 확인 — 가예약 실행은 기존 공개 /p/[token] 흐름 재사용.
//   ★ 누수: 가격 = 파트너에게 제시된 ProposalItem 스냅샷만(원가·마진·consumer가 비노출).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerProposals, type PartnerProposalItemRow } from "@/lib/partner-portal";
import { formatVillaName } from "@/lib/villa-name";
import PaginationBar from "@/components/pagination-bar";
import { parsePageParams } from "@/lib/pagination";
import { formatDate, formatDayMonth, formatVndDot } from "../_format";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";

/** 제안 통화별 아이템 총액 표기 — 파트너에게 제시된 스냅샷 금액(정당 가격) */
function formatItemTotal(saleCurrency: string, it: PartnerProposalItemRow): string {
  if (saleCurrency === "KRW" && it.totalKrw !== null) {
    return `₩${Number(it.totalKrw).toLocaleString("ko-KR")}`;
  }
  if (saleCurrency === "USD" && it.totalUsd !== null) {
    return `$${Number(it.totalUsd).toLocaleString("en-US")}`;
  }
  if (it.totalVnd !== null) return formatVndDot(it.totalVnd);
  return "—";
}

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
  // 코치마크 문구 — RSC 번역 → props (clientMessages 무변경)
  const tTour = await getTranslations("tour");
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
          {pagedProposals.map((p, proposalIdx) => (
            <li
              key={p.token}
              // 코치마크 앵커 — 첫 카드만. 제안 0건이면 투어 자체 미표시(전 앵커 부재)
              data-tour={proposalIdx === 0 ? "partner-proposal" : undefined}
              className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm"
            >
              {/* 헤더 — 개수·만료·상태 + 공개 링크(가예약 실행 경로) */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-bold text-neutral-900">
                    {t("proposals.villaCount", { count: p.itemCount })}
                  </p>
                  <p className="text-sm text-neutral-500">
                    {t("proposals.expires", { date: formatDate(p.expiresAt) })}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                    PROPOSAL_STATUS_STYLE[p.status] ?? "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {t(`proposalStatus.${p.status}`)}
                </span>
              </div>

              {/* 아이템 목록 (T-partner-info 1) — 빌라 병기명·기간·제안가·예약상태 */}
              {p.items.length > 0 && (
                <ul className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
                  {p.items.map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-800">
                          {formatVillaName({ name: it.villaName, nameVi: it.villaNameVi })}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {formatDayMonth(it.checkIn)} – {formatDayMonth(it.checkOut)} ·{" "}
                          {t("bookings.nights", { count: it.nights })}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-teal-700">
                          {formatItemTotal(p.saleCurrency, it)}
                        </p>
                        {it.booked && (
                          <span className="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">
                            {t("proposals.itemBooked")}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* 가예약·상세 — 기존 공개 제안 페이지 흐름 재사용(새 예약 경로 없음) */}
              <a
                href={`/p/${p.token}`}
                target="_blank"
                rel="noopener noreferrer"
                data-tour={proposalIdx === 0 ? "partner-proposal-open" : undefined}
                className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm font-bold text-teal-700 transition-colors hover:bg-teal-100 active:scale-[0.99]"
              >
                <span className="material-symbols-outlined text-lg">open_in_new</span>
                {t("proposals.viewAndBook")}
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(라이트 테마) */}
      <PaginationBar total={proposals.length} page={page} pageSize={pageSize} light />

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 헤더 "?"로 재생 */}
      <CoachMark
        tourId="partnerProposals"
        steps={buildTourSteps(tTour, "partnerProposals")}
        labels={buildTourLabels(tTour)}
      />
    </div>
  );
}
