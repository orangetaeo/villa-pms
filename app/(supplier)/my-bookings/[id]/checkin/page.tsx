// /my-bookings/[id]/checkin — 공급자 vi 직접예약 체크인 (T10.5, F10 D5 / a-supplier-checkin)
// RSC: 권한(SUPPLIER + seller=SUPPLIER + 자기 빌라) + CONFIRMED 가드. 미일치=404(존재 비노출).
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { BookingSeller, BookingStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getSupplierLocale } from "@/lib/locale";
import { toDateOnlyString } from "@/lib/date-vn";
import { getAgreementContent } from "@/lib/agreement-store";

export const metadata: Metadata = { title: "Nhận phòng — Villa Go" };

export default async function SupplierCheckinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "supplierCheckin" });
  const { id } = await params;

  // 소유·주체 가드 — 자기 빌라 AND seller=SUPPLIER 만. 미일치=404(존재 비노출, T10.2 패턴)
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      seller: true,
      guestName: true,
      guestCount: true,
      checkIn: true,
      checkOut: true,
      villa: { select: { name: true, supplierId: true } },
    },
  });
  if (
    !booking ||
    booking.seller !== BookingSeller.SUPPLIER ||
    booking.villa.supplierId !== session.user.id
  ) {
    notFound();
  }

  // CONFIRMED 만 체크인 가능 — 이미 체크인/아웃이면 목록으로
  if (booking.status !== BookingStatus.CONFIRMED) {
    redirect("/my-bookings");
  }

  const agreement = await getAgreementContent();
  const agreementLang = locale === "vi" ? "vi" : "ko";
  const fmt = (d: Date) => toDateOnlyString(d).split("-").reverse().join("/");

  // 클라이언트 폼은 자체 useTranslations(supplierCheckin/.agreement)를 쓰므로
  // 레이아웃 화이트리스트에 supplierCheckin 추가 필요 — layout.tsx 참조.
  const { default: SupplierCheckinForm } = await import("./checkin-form");

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* App bar */}
      <header className="sticky top-0 z-30 w-full border-b border-neutral-100 bg-white shadow-sm">
        <div className="flex h-16 items-center gap-3 px-3">
          <Link
            href="/my-bookings"
            aria-label={t("back")}
            className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 transition-transform active:scale-90"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight">{t("pageTitle")}</h1>
            <p className="truncate text-xs font-medium text-neutral-400">
              {booking.villa.name} ·{" "}
              {booking.guestCount > 1
                ? t("guestsLabel", { name: booking.guestName, n: booking.guestCount - 1 })
                : booking.guestName}
            </p>
          </div>
          <span className="whitespace-nowrap rounded-full border border-teal-100 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
            {fmt(booking.checkIn)}
          </span>
        </div>
      </header>

      <SupplierCheckinForm
        bookingId={booking.id}
        guestCount={booking.guestCount}
        agreement={agreement}
        agreementLang={agreementLang}
      />
    </div>
  );
}
