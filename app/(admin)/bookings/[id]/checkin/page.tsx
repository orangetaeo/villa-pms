// /bookings/[id]/checkin — 체크인 검수 (T3.1, Stitch b3-checkin 변환)
// RSC: booking 로드, CONFIRMED 아니면 상세로 redirect — (admin) 레이아웃 가드 하.
// 동의서·서명(T3.2)·공급자 전달(T3.6) 섹션은 미렌더 (계약 QA 조건 B — 가짜 완료 표시 금지)
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/date-vn";
import CheckinForm from "./checkin-form";

export const metadata: Metadata = {
  title: "체크인 — Villa PMS",
};

export default async function CheckinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("adminCheckin");
  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      guestName: true,
      guestCount: true,
      checkIn: true,
      checkOut: true,
      villa: { select: { name: true } },
    },
  });
  if (!booking) notFound();
  if (booking.status !== BookingStatus.CONFIRMED) {
    redirect(`/bookings/${booking.id}`); // 체크인 가능 상태가 아니면 상세로
  }

  const fmt = (d: Date) => toDateOnlyString(d).replaceAll("-", ".");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Context Banner (b3) */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">
            {t("banner.title", { code: booking.id.slice(-8), villa: booking.villa.name })}
          </h2>
          <p className="text-slate-400 text-sm">
            {fmt(booking.checkIn)}~{fmt(booking.checkOut)} ·{" "}
            {booking.guestCount > 1
              ? t("banner.guests", { name: booking.guestName, n: booking.guestCount - 1 })
              : booking.guestName}
          </p>
        </div>
        <div className="flex flex-col items-end">
          <span className="px-3 py-1 bg-blue-600/20 text-blue-500 border border-blue-600/30 rounded-full text-xs font-bold whitespace-nowrap">
            {t("banner.inProgress")}
          </span>
          <span className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-bold">
            {t("banner.mode")}
          </span>
        </div>
      </div>

      <CheckinForm bookingId={booking.id} guestCount={booking.guestCount} />
    </div>
  );
}
