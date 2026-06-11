// /bookings — 운영자 예약 목록 (T2.5, Stitch b5-bookings 변환)
// RSC: prisma 직접 조회 (신규 목록 API 없음 — 누수 표면 최소화, (admin) 레이아웃 가드 하)
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BookingStatus, VillaStatus, type BookingChannel, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatThousands } from "@/lib/format";
import { toDateOnlyString } from "@/lib/date-vn";
import { todayInVillaTimezone } from "@/lib/timeline";
import {
  computeOccupancyRate,
  formatRemainingHours,
  OCCUPANCY_STAY_STATUSES,
} from "@/lib/booking-stats";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";
import FiltersBar from "./filters-bar";

export const metadata: Metadata = {
  title: "예약 관리 — Villa PMS",
};

const PAGE_SIZE = 20; // 계약 고정 (QA 권고)

// 탭 키 ↔ 상태 매핑. closed = 종결 3종 (b5 "취소/만료" 탭)
const TAB_STATUSES: Record<string, BookingStatus[] | undefined> = {
  all: undefined,
  hold: [BookingStatus.HOLD],
  confirmed: [BookingStatus.CONFIRMED],
  checkedin: [BookingStatus.CHECKED_IN],
  checkedout: [BookingStatus.CHECKED_OUT],
  closed: [BookingStatus.CANCELLED, BookingStatus.EXPIRED, BookingStatus.NO_SHOW],
};
const TAB_ORDER = ["all", "hold", "confirmed", "checkedin", "checkedout", "closed"];

const CHANNELS: BookingChannel[] = ["DIRECT", "TRAVEL_AGENCY", "LAND_AGENCY"];

// b5 상태 배지 클래스
const STATUS_BADGE: Record<BookingStatus, string> = {
  HOLD: "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] font-bold whitespace-nowrap",
  CONFIRMED:
    "inline-block px-2.5 py-1 rounded-md bg-admin-primary text-white text-[11px] font-bold shadow-sm whitespace-nowrap",
  CHECKED_IN:
    "inline-block px-2.5 py-1 rounded-md bg-indigo-600 text-white text-[11px] font-bold shadow-sm whitespace-nowrap",
  CHECKED_OUT:
    "inline-block px-2.5 py-1 rounded-md bg-slate-600 text-white text-[11px] font-bold whitespace-nowrap",
  CANCELLED:
    "inline-block px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/20 text-[11px] font-bold whitespace-nowrap",
  EXPIRED:
    "inline-block px-2.5 py-1 rounded-md bg-slate-800 text-slate-500 border border-slate-700 text-[11px] font-bold whitespace-nowrap",
  NO_SHOW:
    "inline-block px-2.5 py-1 rounded-md bg-slate-800 text-slate-400 border border-slate-700 text-[11px] font-bold whitespace-nowrap",
};

/** YYYY-MM → [월초, 익월초) UTC 자정. 무효 입력은 null */
function parseMonth(month: string | undefined): { start: Date; end: Date } | null {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

function fmtDate(d: Date): string {
  return toDateOnlyString(d).replaceAll("-", ".");
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    month?: string;
    villa?: string;
    channel?: string;
    q?: string;
    page?: string;
    filter?: string;
  }>;
}) {
  const t = await getTranslations("adminBookings");
  const params = await searchParams;
  const now = new Date();
  const today = todayInVillaTimezone(now);

  const tab = params.status && params.status in TAB_STATUSES ? params.status : "all";
  const defaultMonth = toDateOnlyString(today).slice(0, 7);
  const monthRange = parseMonth(params.month) ?? parseMonth(defaultMonth)!;
  const villaId = params.villa || undefined;
  const channel = CHANNELS.includes(params.channel as BookingChannel)
    ? (params.channel as BookingChannel)
    : undefined;
  const q = params.q?.trim() || undefined;
  const preset =
    params.filter === "today-checkin" || params.filter === "today-checkout"
      ? params.filter
      : undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  // 기본 where(상태 제외) — 탭 건수도 이 기준으로 집계.
  // 프리셋(T2.6 링크 계약)은 월·탭을 대체한다 (오늘 = Asia/Ho_Chi_Minh 기준)
  const baseWhere: Prisma.BookingWhereInput = preset
    ? preset === "today-checkin"
      ? { checkIn: today, status: BookingStatus.CONFIRMED }
      : { checkOut: today, status: BookingStatus.CHECKED_IN }
    : {
        checkIn: { lt: monthRange.end },
        checkOut: { gt: monthRange.start },
        ...(villaId ? { villaId } : {}),
        ...(channel ? { channel } : {}),
        ...(q
          ? {
              OR: [
                { guestName: { contains: q, mode: "insensitive" as const } },
                { id: { contains: q } },
              ],
            }
          : {}),
      };

  const statusFilter = preset ? undefined : TAB_STATUSES[tab];
  const where: Prisma.BookingWhereInput = statusFilter
    ? { AND: [baseWhere, { status: { in: statusFilter } }] }
    : baseWhere;

  const [rows, total, statusCounts, villas, activeVillaCount, occupancyBookings, todayCheckin, todayCheckoutPending, todayCheckoutDone, holdCount] =
    await Promise.all([
      prisma.booking.findMany({
        where,
        orderBy: { checkIn: "asc" }, // 체크인 임박순 (SPEC F7)
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          status: true,
          channel: true,
          agencyName: true,
          guestName: true,
          checkIn: true,
          checkOut: true,
          nights: true,
          saleCurrency: true,
          totalSaleKrw: true,
          totalSaleVnd: true,
          holdExpiresAt: true,
          villa: { select: { name: true } },
        },
      }),
      prisma.booking.count({ where }),
      prisma.booking.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
      prisma.villa.findMany({
        where: { status: { in: [VillaStatus.ACTIVE, VillaStatus.INACTIVE] } },
        orderBy: [{ complex: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
      prisma.villa.count({ where: { status: VillaStatus.ACTIVE } }),
      prisma.booking.findMany({
        where: {
          status: { in: [...OCCUPANCY_STAY_STATUSES] },
          checkIn: { lt: monthRange.end },
          checkOut: { gt: monthRange.start },
        },
        select: { status: true, checkIn: true, checkOut: true },
      }),
      prisma.booking.count({ where: { checkIn: today, status: BookingStatus.CONFIRMED } }),
      prisma.booking.count({ where: { checkOut: today, status: BookingStatus.CHECKED_IN } }),
      prisma.booking.count({ where: { checkOut: today, status: BookingStatus.CHECKED_OUT } }),
      prisma.booking.count({ where: { status: BookingStatus.HOLD } }),
    ]);

  const countOf = (statuses: BookingStatus[] | undefined) => {
    if (!statuses) return statusCounts.reduce((n, c) => n + c._count._all, 0);
    return statusCounts
      .filter((c) => statuses.includes(c.status))
      .reduce((n, c) => n + c._count._all, 0);
  };

  const occupancy = computeOccupancyRate(
    occupancyBookings,
    activeVillaCount,
    monthRange.start,
    monthRange.end
  );
  const monthLabel = monthRange.start.getUTCMonth() + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tabHref = (key: string) => {
    const next = new URLSearchParams();
    if (key !== "all") next.set("status", key);
    if (params.month) next.set("month", params.month);
    if (params.villa) next.set("villa", params.villa);
    if (params.channel) next.set("channel", params.channel);
    if (params.q) next.set("q", params.q);
    const qs = next.toString();
    return qs ? `/bookings?${qs}` : "/bookings";
  };
  const pageHref = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) next.set(k, v);
    next.set("page", String(p));
    return `/bookings?${next.toString()}`;
  };

  type Row = (typeof rows)[number];
  const amountCell = (b: Row) =>
    b.saleCurrency === "KRW"
      ? `${formatThousands(b.totalSaleKrw ?? 0)}원`
      : `${formatThousands(b.totalSaleVnd ?? 0n)}₫`;

  const statusBadge = (b: Row) => {
    if (b.status === BookingStatus.HOLD) {
      const countdown = formatRemainingHours(b.holdExpiresAt, now);
      const label =
        countdown === null
          ? t("status.HOLD")
          : countdown.kind === "expired"
            ? `${t("status.HOLD")} (${t("countdown.expired")})`
            : countdown.kind === "hours"
              ? `${t("status.HOLD")} (${t("countdown.hours", { n: countdown.hours })})`
              : `${t("status.HOLD")} (${t("countdown.minutes", { n: countdown.minutes })})`;
      return (
        <span className={STATUS_BADGE.HOLD}>
          <span className="material-symbols-outlined text-[14px]">timer</span>
          {label}
        </span>
      );
    }
    return <span className={STATUS_BADGE[b.status]}>{t(`status.${b.status}`)}</span>;
  };

  const columns: ResponsiveColumn<Row>[] = [
    {
      key: "villa",
      header: t("list.columns.villa"),
      cell: (b) => (
        <Link
          href={`/bookings/${b.id}`}
          className="text-sm font-semibold text-slate-200 whitespace-nowrap after:absolute after:inset-0"
        >
          {b.villa.name}
        </Link>
      ),
    },
    {
      key: "guest",
      header: t("list.columns.guest"),
      cell: (b) => <span className="text-sm text-slate-300 whitespace-nowrap">{b.guestName}</span>,
    },
    {
      key: "channel",
      header: t("list.columns.channel"),
      cell: (b) => (
        <span className="text-xs text-slate-400 font-medium whitespace-nowrap">
          {b.agencyName ? `${b.agencyName} (${t(`channels.${b.channel}`)})` : t(`channels.${b.channel}`)}
        </span>
      ),
    },
    {
      key: "checkIn",
      header: t("list.columns.checkIn"),
      headerClassName: "text-center",
      className: "text-center",
      cell: (b) => (
        <span className="text-sm text-slate-400 tabular-nums whitespace-nowrap">{fmtDate(b.checkIn)}</span>
      ),
    },
    {
      key: "checkOut",
      header: t("list.columns.checkOut"),
      headerClassName: "text-center",
      className: "text-center",
      cell: (b) => (
        <span className="text-sm text-slate-400 tabular-nums whitespace-nowrap">{fmtDate(b.checkOut)}</span>
      ),
    },
    {
      key: "nights",
      header: t("list.columns.nights"),
      headerClassName: "text-center",
      className: "text-center",
      cell: (b) => <span className="text-sm text-slate-400 tabular-nums">{b.nights}</span>,
    },
    {
      key: "amount",
      header: t("list.columns.amount"),
      headerClassName: "text-right",
      className: "text-right",
      cell: (b) => (
        <span className="text-sm font-bold text-slate-200 tabular-nums whitespace-nowrap">
          {amountCell(b)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("list.columns.status"),
      headerClassName: "text-center",
      className: "text-center",
      cell: statusBadge,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">{t("list.title")}</h1>

      {/* 필터·탭 카드 (b5) */}
      <div className="bg-admin-card rounded-xl border border-slate-800/50 shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-800 overflow-x-auto">
          {TAB_ORDER.map((key) => {
            const active = !preset && tab === key;
            return (
              <Link
                key={key}
                href={tabHref(key)}
                className={
                  active
                    ? "px-6 py-4 text-sm font-bold border-b-2 border-admin-primary text-admin-primary whitespace-nowrap"
                    : "px-6 py-4 text-sm font-medium text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition-colors whitespace-nowrap"
                }
              >
                {t(`list.tabs.${key}`)}{" "}
                <span
                  className={`ml-2 px-1.5 py-0.5 rounded text-[11px] ${
                    active ? "bg-admin-primary/10" : "bg-slate-800"
                  }`}
                >
                  {countOf(TAB_STATUSES[key])}
                </span>
              </Link>
            );
          })}
        </div>
        {preset ? (
          <div className="p-4 flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-admin-primary/10 border border-admin-primary/30 text-admin-primary text-sm font-bold">
              <span className="material-symbols-outlined text-sm">filter_alt</span>
              {preset === "today-checkin" ? t("list.preset.todayCheckin") : t("list.preset.todayCheckout")}
            </span>
            <Link href="/bookings" className="text-sm text-slate-400 hover:text-white underline">
              {t("list.preset.clear")}
            </Link>
          </div>
        ) : (
          <FiltersBar villas={villas} />
        )}
      </div>

      {/* 테이블 (≥768px) / 카드 (<768px) — T6.7 */}
      <ResponsiveTable
        columns={columns}
        rows={rows}
        rowKey={(b) => b.id}
        rowClassName={(b) =>
          b.status === BookingStatus.EXPIRED ? "relative opacity-60" : "relative"
        }
        emptyMessage={t("list.empty")}
      />

      {/* 푸터 페이지네이션 (b5) */}
      {total > 0 && (
        <div className="bg-slate-900/50 rounded-xl border border-slate-800 px-6 py-4 flex items-center justify-between">
          <p className="text-xs text-slate-500 whitespace-nowrap">
            {t("list.count", {
              total,
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, total),
            })}
          </p>
          <div className="flex items-center gap-1">
            <Link
              aria-label={t("list.prevPage")}
              aria-disabled={page <= 1}
              href={page > 1 ? pageHref(page - 1) : "#"}
              className={`w-8 h-8 flex items-center justify-center rounded-md border border-slate-700 transition-all ${
                page > 1 ? "text-slate-300 hover:text-white hover:bg-slate-800" : "text-slate-600 pointer-events-none"
              }`}
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </Link>
            <div className="px-4 py-1 text-xs font-bold text-slate-300 whitespace-nowrap">
              {page} / {totalPages}
            </div>
            <Link
              aria-label={t("list.nextPage")}
              aria-disabled={page >= totalPages}
              href={page < totalPages ? pageHref(page + 1) : "#"}
              className={`w-8 h-8 flex items-center justify-center rounded-md border border-slate-700 transition-all ${
                page < totalPages
                  ? "text-slate-300 hover:text-white hover:bg-slate-800"
                  : "text-slate-600 pointer-events-none"
              }`}
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </Link>
          </div>
        </div>
      )}

      {/* 스탯 미니그리드 (b5) — 금일 3종은 전역(오늘 VN 기준), 가동률만 선택 월 (계약 명시) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-admin-card p-4 rounded-xl border border-slate-800/50 flex flex-col gap-1">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest whitespace-nowrap">
            {t("stats.todayCheckin")}
          </p>
          <span className="text-2xl font-black text-white tabular-nums">{todayCheckin}</span>
        </div>
        <div className="bg-admin-card p-4 rounded-xl border border-slate-800/50 flex flex-col gap-1">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest whitespace-nowrap">
            {t("stats.todayCheckout")}
          </p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-black text-white tabular-nums">{todayCheckoutPending}</span>
            <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
              {t("stats.checkoutDone", { n: todayCheckoutDone })}
            </span>
          </div>
        </div>
        <div className="bg-admin-card p-4 rounded-xl border border-slate-800/50 flex flex-col gap-1">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest whitespace-nowrap">
            {t("stats.pendingHolds")}
          </p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-black text-amber-500 tabular-nums">{holdCount}</span>
            <span className="text-xs text-amber-500/80 font-medium whitespace-nowrap">
              {t("stats.pendingHoldsHint")}
            </span>
          </div>
        </div>
        <div className="bg-admin-card p-4 rounded-xl border border-slate-800/50 flex flex-col gap-1">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest whitespace-nowrap">
            {t("stats.occupancy", { month: monthLabel })}
          </p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-black text-admin-primary tabular-nums">{occupancy}%</span>
            <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-admin-primary" style={{ width: `${Math.min(occupancy, 100)}%` }}></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
