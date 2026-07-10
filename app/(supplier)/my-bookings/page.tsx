// /my-bookings — 공급자 vi 직접예약 검수 목록 (T10.5 진입점, F10 D5)
// 공급자 자기 직접예약(seller=SUPPLIER)만. 검수 대기(CONFIRMED→체크인 / CHECKED_IN→체크아웃) 우선 노출.
// 재고·마진 비공개: 판매가 KRW·우리 마진·고객 상세 없음. 자기 빌라·자기 예약만.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { BookingSeller, BookingStatus, Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getSupplierLocale } from "@/lib/locale";
import { toDateOnlyString } from "@/lib/date-vn";
import PaginationBar from "@/components/pagination-bar";
import ListSearch from "@/components/list-search";
import { parsePageParams } from "@/lib/pagination";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";

export const metadata: Metadata = { title: "Đặt phòng trực tiếp — Villa Go" };

export default async function SupplierMyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "myBookings" });
  // 코치마크 문구 — RSC 번역 → props (화이트리스트 비의존, cleaning-submit 패턴)
  const tTour = await getTranslations({ locale, namespace: "tour" });
  const params = await searchParams;
  const { page, pageSize, skip, take } = parsePageParams(params);
  // 검색어(URL q 모드) — 빌라명·투숙객명. 자기 스코프(supplierId) 안에서만 검색(누수 0).
  const q = params.q?.trim() || undefined;

  // 자기 직접예약만 — seller=SUPPLIER AND 자기 빌라. 검수 가능 상태(CONFIRMED·CHECKED_IN) 우선.
  // 누수 0: guestName(식별용 표시)·인원·날짜·상태만. 판매가 KRW·우리 마진·원가 select 안 함.
  const where: Prisma.BookingWhereInput = {
    seller: BookingSeller.SUPPLIER,
    villa: { supplierId: session.user.id },
    status: {
      in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT],
    },
    ...(q
      ? {
          OR: [
            { villa: { name: { contains: q, mode: "insensitive" } } },
            { guestName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  // 페이지네이션 — DB 단 skip/take + count(perf). 기존엔 100건을 통째로 불러와 메모리 slice 했고
  // 100건 초과분은 아예 안 보였다. 이제 현재 페이지 행만 조회(checkIn asc 정렬은 DB가 수행).
  const [totalBookings, pagedBookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: [{ checkIn: "asc" }],
      skip,
      take,
      select: {
        id: true,
        status: true,
        checkIn: true,
        checkOut: true,
        guestName: true,
        guestCount: true,
        villa: { select: { name: true } },
      },
    }),
  ]);

  const fmt = (d: Date) => toDateOnlyString(d).split("-").reverse().join("/");

  // 검수 대기(CONFIRMED·CHECKED_IN) 먼저, 완료(CHECKED_OUT) 나중 — 현재 페이지 슬라이스 내에서 분류
  const pending = pagedBookings.filter((b) => b.status !== BookingStatus.CHECKED_OUT);
  const done = pagedBookings.filter((b) => b.status === BookingStatus.CHECKED_OUT);

  return (
    <div className="mx-auto max-w-md px-4 pb-8 pt-6">
      <h1 className="mb-1 text-xl font-bold text-neutral-900">{t("title")}</h1>
      <p className="mb-4 text-sm text-neutral-400">{t("subtitle")}</p>

      {/* 검색 (URL q 모드, 라이트) — 빌라명·투숙객명. 검색 중이면 결과 0건이어도 입력 유지 */}
      {(totalBookings > 0 || q) && (
        <div className="mb-6">
          <ListSearch light placeholder={t("searchPlaceholder")} />
        </div>
      )}

      {totalBookings === 0 ? (
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
              {pending.map((b, i) => (
                // 코치마크 앵커 — 화면 첫 카드에만(대기 섹션이 위). 빈 목록이면 자동 스킵
                <BookingCard key={b.id} booking={b} t={t} fmt={fmt} tourAnchor={i === 0} />
              ))}
            </section>
          )}
          {done.length > 0 && (
            <section className="space-y-3">
              <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-neutral-400">
                {t("doneSection")}
              </h2>
              {done.map((b, i) => (
                // 대기 카드가 없을 때만 완료 첫 카드가 화면 첫 카드 → 앵커 승계
                <BookingCard
                  key={b.id}
                  booking={b}
                  t={t}
                  fmt={fmt}
                  tourAnchor={pending.length === 0 && i === 0}
                />
              ))}
            </section>
          )}

          {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(라이트 테마) */}
          <PaginationBar total={totalBookings} page={page} pageSize={pageSize} light />
        </div>
      )}

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 헤더 "?"로 재생. 카드/버튼 앵커는 첫 카드
          조건부라 빈 목록·완료-only(액션 버튼 없음)에서는 해당 스텝 자동 스킵 */}
      <CoachMark
        tourId="myBookings"
        steps={buildTourSteps(tTour, "myBookings")}
        labels={buildTourLabels(tTour)}
      />
    </div>
  );
}

function BookingCard({
  booking,
  t,
  fmt,
  tourAnchor = false,
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
  /** 코치마크 앵커(mybook-card·mybook-action) — 화면 첫 카드에만 true */
  tourAnchor?: boolean;
}) {
  const isCheckin = booking.status === BookingStatus.CONFIRMED;
  const isCheckout = booking.status === BookingStatus.CHECKED_IN;
  const isDone = booking.status === BookingStatus.CHECKED_OUT;

  return (
    // 코치마크 앵커(mybook-card) — 첫 카드에만 부착
    <div
      data-tour={tourAnchor ? "mybook-card" : undefined}
      className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm"
    >
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
          // 코치마크 앵커(mybook-action) — 첫 카드에만. 완료 카드는 버튼 없음 → 자동 스킵
          data-tour={tourAnchor ? "mybook-action" : undefined}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 font-bold text-white transition-transform active:scale-[0.98]"
        >
          <span className="material-symbols-outlined">how_to_reg</span>
          {t("doCheckin")}
        </Link>
      )}
      {isCheckout && (
        <Link
          href={`/my-bookings/${booking.id}/checkout`}
          // 코치마크 앵커(mybook-action) — 체크아웃 branch에도 동일 부착(첫 카드 상태에 따라 한쪽만 렌더)
          data-tour={tourAnchor ? "mybook-action" : undefined}
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
