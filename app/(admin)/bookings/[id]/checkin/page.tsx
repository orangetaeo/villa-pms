// /bookings/[id]/checkin — 체크인 검수 (T3.1, Stitch b3-checkin 변환)
// RSC: booking 로드, CONFIRMED 아니면 상세로 redirect — (admin) 레이아웃 가드 하.
// 동의서·서명(T3.2)은 §3 + 사후 서명 모드로 구현됨. 공급자 전달(T3.6)만 미렌더 (조건 B)
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/date-vn";
import CheckinForm from "./checkin-form";
import PostSignForm from "./post-sign-form";

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
      // wifiSsid·wifiPassword는 ADMIN 권한 게이트((admin) 레이아웃) 뒤에서만 로드 — 체크인 화면 전용
      // (/p 공개페이지에는 절대 select 금지, ADR-0011 §4.3). 표시는 FE 단계.
      villa: { select: { name: true, hasPool: true, wifiSsid: true, wifiPassword: true } },
      checkInRecord: { select: { signatureUrl: true } },
    },
  });
  if (!booking) notFound();
  // T3.2 사후 서명 모드 — CHECKED_IN + 체크인 기록 존재 + 미서명 (계약 결정 2)
  const postSignMode =
    booking.status === BookingStatus.CHECKED_IN &&
    booking.checkInRecord !== null &&
    !booking.checkInRecord.signatureUrl;
  if (booking.status !== BookingStatus.CONFIRMED && !postSignMode) {
    redirect(`/bookings/${booking.id}`); // 체크인 가능·사후 서명 상태가 아니면 상세로
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
            {postSignMode ? t("agreement.postSignBadge") : t("banner.inProgress")}
          </span>
          <span className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-bold">
            {t("banner.mode")}
          </span>
        </div>
      </div>

      {/* 와이파이 안내 (ADR-0011) — ADMIN 전용 화면이라 노출 OK. /p 공개페이지엔 절대 미노출 */}
      {(booking.villa.wifiSsid || booking.villa.wifiPassword) && (
        <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-800 flex items-center gap-3">
          <span className="material-symbols-outlined text-admin-primary">wifi</span>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {t("wifi.title")}
            </span>
            {booking.villa.wifiSsid && (
              <span className="text-slate-300">
                <span className="text-slate-500">{t("wifi.ssid")}</span>{" "}
                <span className="font-bold text-white">{booking.villa.wifiSsid}</span>
              </span>
            )}
            {booking.villa.wifiPassword && (
              <span className="text-slate-300">
                <span className="text-slate-500">{t("wifi.password")}</span>{" "}
                <span className="font-bold text-white tabular-nums">{booking.villa.wifiPassword}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {postSignMode ? (
        <PostSignForm bookingId={booking.id} hasPool={booking.villa.hasPool} />
      ) : (
        <CheckinForm
          bookingId={booking.id}
          guestCount={booking.guestCount}
          hasPool={booking.villa.hasPool}
        />
      )}
    </div>
  );
}
