// app/partner/bookings/[id]/page.tsx — 파트너 예약 상세 + 투숙객 명단 사전 제출 (여행사 포털 E)
//   Role=PARTNER 전용(layout 가드). 본인 partnerId 예약만(loadPartnerBookingDetail, IDOR 차단).
//   ★ 누수: totalSaleKrw·원가·마진·미니바·서비스 비조회. 빌라명은 비운영자 병기.
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getPartnerForUser } from "@/lib/partner-auth";
import { loadPartnerBookingDetail } from "@/lib/partner-portal";
import { formatVillaName } from "@/lib/villa-name";
import { formatVndDot, formatDate } from "../../_format";
import PartnerRosterForm from "@/components/partner/partner-roster-form";

export const metadata: Metadata = {
  title: "예약 상세 — Villa Go",
};

const STATUS_STYLE: Record<string, string> = {
  HOLD: "bg-amber-100 text-amber-700",
  CONFIRMED: "bg-teal-100 text-teal-700",
  CHECKED_IN: "bg-blue-100 text-blue-700",
  CHECKED_OUT: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-neutral-100 text-neutral-500",
  EXPIRED: "bg-neutral-100 text-neutral-500",
  NO_SHOW: "bg-rose-100 text-rose-700",
};

export default async function PartnerBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARTNER") redirect("/login");

  const partner = await getPartnerForUser(session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") redirect("/partner");

  const { id } = await params;
  const booking = await loadPartnerBookingDetail(partner.id, id);
  if (!booking) notFound(); // 미소유/미존재(IDOR 차단)

  const t = await getTranslations("partner");
  const statusStyle = STATUS_STYLE[booking.status] ?? "bg-neutral-100 text-neutral-500";

  return (
    <div className="space-y-5">
      <Link
        href="/partner"
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-800"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        {t("bookingDetail.back")}
      </Link>

      {/* 예약 요약 카드 */}
      <section className="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-lg font-bold text-neutral-900">
              {formatVillaName({ name: booking.villaName, nameVi: booking.villaNameVi })}
            </h1>
            {booking.villaComplex && (
              <p className="truncate text-xs text-neutral-400">{booking.villaComplex}</p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${statusStyle}`}
          >
            {t(`status.${booking.status}`)}
          </span>
        </div>

        <dl className="mt-4 space-y-2.5 border-t border-neutral-100 pt-4 text-sm">
          <Row label={t("bookingDetail.stay")}>
            {formatDate(booking.checkIn)} – {formatDate(booking.checkOut)} ·{" "}
            {t("bookings.nights", { count: booking.nights })}
          </Row>
          <Row label={t("bookingDetail.guest")}>{booking.guestName}</Row>
          <Row label={t("bookingDetail.guestCount")}>
            {t("bookings.guests", { count: booking.guestCount })}
          </Row>
          {booking.roomChargeVnd && (
            <Row label={t("bookings.roomCharge")}>
              <span className="font-bold text-teal-700">
                {formatVndDot(booking.roomChargeVnd)}
              </span>
            </Row>
          )}
        </dl>
      </section>

      {/* 투숙객 명단 사전 제출 */}
      <section className="rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-base font-bold text-neutral-900">{t("roster.title")}</h2>
        <p className="mb-4 text-sm text-neutral-500">{t("roster.subtitle")}</p>
        <PartnerRosterForm
          bookingId={booking.id}
          initialRoster={booking.guestRoster}
          canEdit={booking.canEditRoster}
        />
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 font-medium text-neutral-400">{label}</dt>
      <dd className="text-right text-neutral-800">{children}</dd>
    </div>
  );
}
