// /my-bookings — 공급자 vi 직접예약 검수 목록 (T10.5 진입점, F10 D5)
// 공급자 자기 직접예약(seller=SUPPLIER)만. 검수 대기(CONFIRMED→체크인 / CHECKED_IN→체크아웃) 우선 노출.
// 재고·마진 비공개: 판매가 KRW·우리 마진·고객 상세 없음. 자기 빌라·자기 예약만.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { BookingSeller, BookingStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getSupplierLocale } from "@/lib/locale";
import { toDateOnlyString } from "@/lib/date-vn";
import PaginationBar from "@/components/pagination-bar";
import { parsePageParams } from "@/lib/pagination";

export const metadata: Metadata = { title: "Đặt phòng trực tiếp — Villa Go" };

export default async function SupplierMyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "myBookings" });
  const { page, pageSize, skip, take } = parsePageParams(await searchParams);

  // 자기 직접예약만 — seller=SUPPLIER AND 자기 빌라. 검수 가능 상태(CONFIRMED·CHECKED_IN) 우선.
  // 누수 0: guestName(식별용 표시)·인원·날짜·상태만. 판매가 KRW·우리 마진·원가 select 안 함.
  const bookings = await prisma.booking.findMany({
    where: {
      seller: BookingSeller.SUPPLIER,
      villa: { supplierId: session.user.id },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT] },
    },
    orderBy: [{ checkIn: "asc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      guestName: true,
      guestCount: true,
      villa: { select: { name: true } },
    },
  });

  const fmt = (d: Date) => toDateOnlyString(d).split("-").reverse().join("/");

  // 페이지네이션 — checkIn asc 정렬된 전체 목록을 메모리 슬라이스(take:100 캡 내). 빈 상태는 전체 기준.
  const totalBookings = bookings.length;
  const pagedBookings = bookings.slice(skip, skip + take);

  // 검수 대기(CONFIRMED·CHECKED_IN) 먼저, 완료(CHECKED_OUT) 나중 — 현재 페이지 슬라이스 내에서 분류
  const pending = pagedBookings.filter((b) => b.status !== BookingStatus.CHECKED_OUT);
  const done = pagedBookings.filter((b) => b.status === BookingStatus.CHECKED_OUT);

  return (
    <div className="mx-auto max-w-md px-4 pb-8 pt-6">
      <h1 className="mb-1 text-xl font-bold text-neutral-900">{t("title")}</h1>
      <p className="mb-6 text-sm text-neutral-400">{t("subtitle")}</p>

      {bookings.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-neutral-100 bg-white p-8 text-center shadow-sm">
          <span className="material-symbols-outlined text-5xl text-teal-600">book_online</span>
          <p className="text-sm font-medium text-neutral-600">{t("empty")}</p>
          <Link
            href="/calendar"
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-teal-600 px-5 font-bold text-white active:scale-95"
          >
            <span className="material-symbols-outlined">calendar_month</span>
            {t("goCalendar")}
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section className="space-y-3">
              <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-neutral-400">
                {t("pendingSection")}
              </h2>
              {pending.map((b) => (
                <BookingCard key={b.id} booking={b} t={t} fmt={fmt} />
              ))}
            </section>
          )}
          {done.length > 0 && (
            <section className="space-y-3">
              <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-neutral-400">
                {t("doneSection")}
              </h2>
              {done.map((b) => (
                <BookingCard key={b.id} booking={b} t={t} fmt={fmt} />
              ))}
            </section>
          )}

          {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(라이트 테마) */}
          <PaginationBar total={totalBookings} page={page} pageSize={pageSize} light />
        </div>
      )}
    </div>
  );
}

function BookingCard({
  booking,
  t,
  fmt,
}: {
  booking: {
    id: string;
    status: BookingStatus;
    checkIn: Date;
    checkOut: Date;
    guestName: string;
    guestCount: number;
    villa: { name: string };
  };
  t: (key: string, values?: Record<string, string | number>) => string;
  fmt: (d: Date) => string;
}) {
  const isCheckin = booking.status === BookingStatus.CONFIRMED;
  const isCheckout = booking.status === BookingStatus.CHECKED_IN;
  const isDone = booking.status === BookingStatus.CHECKED_OUT;

  return (
    <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold text-neutral-800">{booking.villa.name}</p>
          <p className="truncate text-sm text-neutral-500">
            {booking.guestCount > 1
              ? t("guestsLabel", { name: booking.guestName, n: booking.guestCount - 1 })
              : booking.guestName}
          </p>
          <p className="mt-1 text-xs font-medium tabular-nums text-neutral-400">
            {fmt(booking.checkIn)} → {fmt(booking.checkOut)}
          </p>
        </div>
        <StatusBadge status={booking.status} t={t} />
      </div>

      {isCheckin && (
        <Link
          href={`/my-bookings/${booking.id}/checkin`}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 font-bold text-white transition-transform active:scale-[0.98]"
        >
          <span className="material-symbols-outlined">how_to_reg</span>
          {t("doCheckin")}
        </Link>
      )}
      {isCheckout && (
        <Link
          href={`/my-bookings/${booking.id}/checkout`}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-teal-600 bg-white font-bold text-teal-600 transition-transform active:scale-[0.98]"
        >
          <span className="material-symbols-outlined">logout</span>
          {t("doCheckout")}
        </Link>
      )}
      {isDone && (
        <div className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-50 text-sm font-semibold text-neutral-400">
          <span className="material-symbols-outlined text-[18px]">task_alt</span>
          {t("completed")}
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: BookingStatus;
  t: (key: string) => string;
}) {
  const map: Record<string, { label: string; cls: string }> = {
    [BookingStatus.CONFIRMED]: {
      label: t("status.confirmed"),
      cls: "border-teal-100 bg-teal-50 text-teal-700",
    },
    [BookingStatus.CHECKED_IN]: {
      label: t("status.checkedIn"),
      cls: "border-blue-100 bg-blue-50 text-[#2563EB]",
    },
    [BookingStatus.CHECKED_OUT]: {
      label: t("status.checkedOut"),
      cls: "border-neutral-200 bg-neutral-50 text-neutral-400",
    },
  };
  const s = map[status] ?? map[BookingStatus.CONFIRMED];
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold ${s.cls}`}>
      {s.label}
    </span>
  );
}
