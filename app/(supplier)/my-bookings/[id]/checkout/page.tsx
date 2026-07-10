// /my-bookings/[id]/checkout — 공급자 vi 직접예약 체크아웃 (T10.5, F10 D5/D6 / a-supplier-checkout)
// RSC: 권한(SUPPLIER + seller=SUPPLIER + 자기 빌라) + CHECKED_IN 가드. 미일치=404(존재 비노출).
// 미니바: 회사표준 MinibarItem(판매가) + 빌라별 par(VillaMinibarStock.qty ?? stockQty). 원가·마진 비select.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { BookingSeller, BookingStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getSupplierLocale } from "@/lib/locale";
import { minibarItemName } from "@/lib/minibar";
import { toDateOnlyString } from "@/lib/date-vn";
import type { MinibarItemView } from "./checkout-form";

export const metadata: Metadata = { title: "Trả phòng — Villa Go" };

export default async function SupplierCheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "supplierCheckout" });
  const { id } = await params;

  // 소유·주체 가드 — 자기 빌라 AND seller=SUPPLIER. 빌라 기준사진도 함께 로드.
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      seller: true,
      guestName: true,
      guestCount: true,
      checkOut: true,
      depositAmount: true,
      depositCurrency: true,
      villaId: true,
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
  if (booking.status !== BookingStatus.CHECKED_IN) {
    redirect("/my-bookings");
  }

  // 미니바 회사표준(판매가만 — costVnd 비select) + 이 빌라 par 오버라이드
  const [minibarItems, villaStocks] = await Promise.all([
    prisma.minibarItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      // 판매가만 — costVnd는 절대 select 안 함 (마진 비공개)
      select: { id: true, nameKo: true, nameVi: true, unitPriceVnd: true, stockQty: true },
    }),
    prisma.villaMinibarStock.findMany({
      where: { villaId: booking.villaId },
      select: { minibarItemId: true, qty: true },
    }),
  ]);
  const parByItem = new Map(villaStocks.map((s) => [s.minibarItemId, s.qty]));

  const minibar: MinibarItemView[] = minibarItems.map((m) => ({
    id: m.id,
    label: minibarItemName(m, locale),
    unitPriceVnd: m.unitPriceVnd.toString(),
    par: parByItem.get(m.id) ?? m.stockQty,
  }));

  // 보증금(VND 수취분만) — 현장 보증금은 VND. KRW/USD면 정산 요약 비표시(공급자 현장은 동 단위).
  const depositVnd =
    booking.depositAmount != null && booking.depositCurrency === "VND"
      ? String(booking.depositAmount)
      : null;

  const fmt = (d: Date) => toDateOnlyString(d).split("-").reverse().join("/");

  const { default: SupplierCheckoutForm } = await import("./checkout-form");

  return (
    <div className="min-h-screen bg-neutral-50">
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
            {fmt(booking.checkOut)}
          </span>
        </div>
      </header>

      <SupplierCheckoutForm
        bookingId={booking.id}
        minibar={minibar}
        depositVnd={depositVnd}
      />
    </div>
  );
}
