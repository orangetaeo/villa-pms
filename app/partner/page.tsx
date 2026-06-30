// app/partner/page.tsx — 파트너 예약 현황 (ADR-0028 PP3)
//   Role=PARTNER 전용(layout 가드). 자기 partnerId 스코프 예약만(loadPartnerBookings).
//   ★ 누수: totalSaleKrw·원가·마진·미니바·서비스 비조회. 빌라명은 비운영자 병기(formatVillaName).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerBookings } from "@/lib/partner-portal";
import PartnerBookingsList from "./partner-bookings-list";

export const metadata: Metadata = {
  title: "예약 현황 — Villa Go",
};

export default async function PartnerBookingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARTNER") redirect("/login");

  const partner = await getPartnerForUser(session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") redirect("/partner");

  const t = await getTranslations("partner");
  // 자기 partnerId 스코프 예약(서버 스코프 유지) — 검색·페이지네이션은 클라 표시 필터
  const bookings = await loadPartnerBookings(partner.id);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold text-neutral-900">{t("bookings.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t("bookings.subtitle")}</p>
      </header>

      {bookings.length === 0 ? (
        <EmptyState
          icon="event_busy"
          title={t("bookings.empty")}
          hint={t("bookings.emptyHint")}
        />
      ) : (
        <PartnerBookingsList bookings={bookings} />
      )}
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
