// SUPPLIER 월 달력 (T1.4, SPEC F2) — a3-calendar 디자인 변환
// 재고 비공개 원칙: 클라이언트에는 날짜·상태·블록 id/source만 전달
// (고객명·금액·예약 id는 select 단계에서 아예 조회하지 않는다)
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { OCCUPYING_BOOKING_STATUSES, overlapsHalfOpen } from "@/lib/availability";
import { addUtcDays, todayVnDateString } from "@/lib/date-vn";
import { toDateOnlyString } from "@/lib/date-vn";
import { CalendarView, type DayCell, type BookingDetail } from "./calendar-view";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const metadata: Metadata = {
  title: "Lịch — Villa Go",
};

export default async function SupplierCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ villaId?: string; month?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "calendar" });

  // 자기 빌라만 — supplierId 스코프 강제
  const villas = await prisma.villa.findMany({
    where: { supplierId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, nameVi: true },
  });

  const { villaId: villaIdParam, month: monthParam } = await searchParams;
  const todayStr = todayVnDateString(); // Asia/Ho_Chi_Minh 기준 오늘
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : todayStr.slice(0, 7);

  if (villas.length === 0) {
    return (
      <div className="px-4 pt-6">
        <h1 className="mb-4 text-xl font-bold text-neutral-900">{t("title")}</h1>
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <span className="material-symbols-outlined text-5xl text-teal-600">villa</span>
          <p className="text-sm font-medium text-neutral-600">{t("noVillas")}</p>
          <Link
            href="/my-villas/new"
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-teal-600 px-6 font-bold text-white active:scale-95"
          >
            <span className="material-symbols-outlined">add</span>
            {t("addVilla")}
          </Link>
        </div>
      </div>
    );
  }

  // 선택 빌라 — 잘못된 villaId는 첫 빌라로 폴백 (타인 빌라 id를 넣어도 자기 목록에 없으므로 무시됨)
  const selectedVilla = villas.find((v) => v.id === villaIdParam) ?? villas[0];

  // 월 범위 [monthStart, monthEnd) — UTC 자정 정규화
  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
  const monthEnd = new Date(Date.UTC(year, monthNum, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();

  // 해당 월과 겹치는 점유 예약 + 차단 — half-open 겹침 (startDate < 월말+1 AND endDate > 월초)
  const [bookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        villaId: selectedVilla.id,
        status: { in: [...OCCUPYING_BOOKING_STATUSES] },
        checkIn: { lt: monthEnd },
        checkOut: { gt: monthStart },
      },
      // 누수 0: 공급자 본인 정산 예정액(supplierCostVnd)·인원·박수·상태·홀드만료만.
      //   guestName·totalSale*(판매가)·guestPhone·agencyName 등은 절대 select 안 함 (마진·고객 비공개).
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        status: true,
        nights: true,
        guestCount: true,
        supplierCostVnd: true,
        holdExpiresAt: true,
      },
    }),
    prisma.calendarBlock.findMany({
      where: {
        villaId: selectedVilla.id,
        startDate: { lt: monthEnd },
        endDate: { gt: monthStart },
      },
      select: { id: true, startDate: true, endDate: true, source: true },
    }),
  ]);

  // 예약 상세 — bookingId → 바텀시트 표시 데이터(누수 안전 필드만). VND 문자열로 직렬화.
  const bookingDetails: Record<string, BookingDetail> = {};
  for (const b of bookings) {
    bookingDetails[b.id] = {
      id: b.id,
      status: b.status === "HOLD" ? "HOLD" : "BOOKED",
      checkIn: toDateOnlyString(b.checkIn),
      checkOut: toDateOnlyString(b.checkOut),
      nights: b.nights,
      guestCount: b.guestCount,
      supplierPayoutVnd: b.supplierCostVnd.toString(),
      holdExpiresAt: b.holdExpiresAt ? b.holdExpiresAt.toISOString() : null,
    };
  }

  // 날짜별 셀 상태 산출 — 겹침 판정은 lib/availability의 overlapsHalfOpen만 사용
  const days: DayCell[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const cellStart = new Date(Date.UTC(year, monthNum - 1, day));
    const cellEnd = addUtcDays(cellStart, 1);
    const dateStr = cellStart.toISOString().slice(0, 10);

    const booking = bookings.find((b) =>
      overlapsHalfOpen(cellStart, cellEnd, b.checkIn, b.checkOut)
    );
    const overlappingBlocks = blocks.filter((b) =>
      overlapsHalfOpen(cellStart, cellEnd, b.startDate, b.endDate)
    );
    // MANUAL 우선 — 해제 가능한 블록을 우선 노출
    const block =
      overlappingBlocks.find((b) => b.source === "MANUAL") ?? overlappingBlocks[0];

    // 우선순위: 예약(확정·체크인 > 홀드) > 차단 > 공실
    const status = booking
      ? booking.status === "HOLD"
        ? ("HOLD" as const)
        : ("BOOKED" as const)
      : block
        ? ("BLOCKED" as const)
        : ("AVAILABLE" as const);

    days.push({
      date: dateStr,
      day,
      status,
      ...(status === "BLOCKED" && block
        ? { blockId: block.id, blockSource: block.source }
        : {}),
      ...((status === "BOOKED" || status === "HOLD") && booking
        ? { bookingId: booking.id }
        : {}),
      isPast: dateStr < todayStr,
    });
  }

  // 월~일 그리드 선행 공백 (월요일 시작 — a3 헤더 T2..CN)
  const leadingBlanks = (monthStart.getUTCDay() + 6) % 7;

  return (
    <CalendarView
      villas={villas}
      selectedVillaId={selectedVilla.id}
      month={month}
      days={days}
      leadingBlanks={leadingBlanks}
      bookingDetails={bookingDetails}
    />
  );
}
