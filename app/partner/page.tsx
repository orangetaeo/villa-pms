// app/partner/page.tsx — 파트너 예약 현황 (ADR-0028 PP3)
//   Role=PARTNER 전용(layout 가드). 자기 partnerId 스코프 예약만(loadPartnerBookings).
//   ★ 누수: totalSaleKrw·원가·마진·미니바·서비스 비조회. 빌라명은 비운영자 병기(formatVillaName).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerBookings, type PartnerBookingRow } from "@/lib/partner-portal";
import { formatVillaName } from "@/lib/villa-name";
import PaginationBar from "@/components/pagination-bar";
import { parsePageParams } from "@/lib/pagination";
import { formatVndDot, formatDayMonth } from "./_format";

export const metadata: Metadata = {
  title: "예약 현황 — Villa Go",
};

// 예약 상태 → 뱃지 색. (상태 라벨 텍스트는 i18n partner.status)
const STATUS_STYLE: Record<string, string> = {
  HOLD: "bg-amber-100 text-amber-700",
  CONFIRMED: "bg-teal-100 text-teal-700",
  CHECKED_IN: "bg-blue-100 text-blue-700",
  CHECKED_OUT: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-neutral-100 text-neutral-500",
  EXPIRED: "bg-neutral-100 text-neutral-500",
  NO_SHOW: "bg-rose-100 text-rose-700",
};

export default async function PartnerBookingsPage({
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
  // 자기 partnerId 스코프 예약(서버 스코프 유지) — 표시 슬라이스만 추가
  const bookings = await loadPartnerBookings(partner.id);

  // 페이지네이션 — 예약은 누적되어 늘어나는 목록. URL page/pageSize 기준 메모리 슬라이스(라이트 테마).
  const params = await searchParams;
  const { page, pageSize, skip, take } = parsePageParams(params);
  const pagedBookings = bookings.slice(skip, skip + take);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold text-neutral-900">{t("bookings.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t("bookings.subtitle")}</p>
      </header>

      {bookings.length === 0 ? (
        // 빈 상태는 전체 기준 유지
        <EmptyState
          icon="event_busy"
          title={t("bookings.empty")}
          hint={t("bookings.emptyHint")}
        />
      ) : (
        <ul className="space-y-3">
          {pagedBookings.map((b) => (
            <BookingCard key={b.id} booking={b} t={t} />
          ))}
        </ul>
      )}

      {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(라이트 테마) */}
      <PaginationBar total={bookings.length} page={page} pageSize={pageSize} light />
    </div>
  );
}

function BookingCard({
  booking,
  t,
}: {
  booking: PartnerBookingRow;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const statusStyle = STATUS_STYLE[booking.status] ?? "bg-neutral-100 text-neutral-500";
  return (
    <li className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="truncate font-bold text-neutral-900">
            {formatVillaName({ name: booking.villaName, nameVi: booking.villaNameVi })}
          </h2>
          {booking.villaComplex && (
            <p className="truncate text-xs text-neutral-400">{booking.villaComplex}</p>
          )}
          <p className="text-sm text-neutral-500">
            {formatDayMonth(booking.checkIn)} – {formatDayMonth(booking.checkOut)} ·{" "}
            {t("bookings.nights", { count: booking.nights })}
          </p>
          <p className="text-sm text-neutral-600">
            {booking.guestName} ·{" "}
            {t("bookings.guests", { count: booking.guestCount })}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${statusStyle}`}
        >
          {t(`status.${booking.status}`)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
        <span className="text-xs font-medium text-neutral-400">
          {t("bookings.roomCharge")}
        </span>
        <span className="text-base font-bold text-teal-700">
          {formatVndDot(booking.roomChargeVnd)}
        </span>
      </div>
    </li>
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
