// app/partner/page.tsx — 파트너 예약 현황 (ADR-0028 PP3 + T-partner-scale 1)
//   Role=PARTNER 전용(layout 가드). 자기 partnerId 스코프 예약만(loadPartnerBookings).
//   서버 페이지네이션 — 검색(q)·기간(from/to)·page/pageSize를 URL로 받아 서버 where/skip/take.
//   ★ 누수: totalSaleKrw·원가·마진·미니바 비조회. 빌라명은 비운영자 병기(formatVillaName).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerBookings } from "@/lib/partner-portal";
import { parsePageParams } from "@/lib/pagination";
import PartnerBookingsList from "./partner-bookings-list";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";

export const metadata: Metadata = {
  title: "예약 현황 — Villa Go",
};

export default async function PartnerBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    from?: string;
    to?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARTNER") redirect("/login");

  const partner = await getPartnerForUser(session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") redirect("/partner");

  const t = await getTranslations("partner");
  // 코치마크 문구 — RSC 번역 → props (clientMessages 무변경)
  const tTour = await getTranslations("tour");

  // 서버 페이지네이션 (T-partner-scale 1) — URL이 단일 진실(검색·기간·페이지)
  const params = await searchParams;
  const { page, pageSize, skip, take } = parsePageParams(params);
  const q = params.q?.trim() || undefined;
  const from = params.from || undefined;
  const to = params.to || undefined;
  const { rows, total } = await loadPartnerBookings(partner.id, {
    q,
    from,
    to,
    skip,
    take,
  });

  const hasFilter = Boolean(q || from || to);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold text-neutral-900">{t("bookings.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t("bookings.subtitle")}</p>
      </header>

      {total === 0 && !hasFilter ? (
        <EmptyState
          icon="event_busy"
          title={t("bookings.empty")}
          hint={t("bookings.emptyHint")}
        />
      ) : (
        <PartnerBookingsList
          bookings={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          dateFrom={from ?? ""}
          dateTo={to ?? ""}
        />
      )}

      {/* 코치마크 투어 — 삼항 밖 마운트: 예약 0건 신규 파트너에게도 벨·탭바 스텝은 표시
          (partner-booking 앵커만 자동 스킵, FE 회의 확정) */}
      <CoachMark
        tourId="partnerHome"
        steps={buildTourSteps(tTour, "partnerHome")}
        labels={buildTourLabels(tTour)}
      />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: string;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-10 text-center shadow-sm">
      <span className="material-symbols-outlined text-5xl text-teal-600">{icon}</span>
      <p className="text-sm font-bold text-neutral-700">{title}</p>
      <p className="text-sm text-neutral-500">{hint}</p>
    </div>
  );
}
