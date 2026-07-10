// /bookings — 운영자 예약 목록 (T2.5, Stitch b5-bookings 변환)
// RSC: prisma 직접 조회 (신규 목록 API 없음 — 누수 표면 최소화, (admin) 레이아웃 가드 하)
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BookingSeller, BookingStatus, VillaStatus, type BookingChannel, type Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatThousands } from "@/lib/format";
import { toDateOnlyString, quickRangeWhere, parseUtcDateOnly } from "@/lib/date-vn";
import {
  resolveBookingDateBasis,
  buildBookingDateBasisWhere,
  type BookingDateBasis,
} from "@/lib/booking-date-filter";
import { todayInVillaTimezone } from "@/lib/timeline";
import {
  computeOccupancyRate,
  formatRemainingHours,
  OCCUPANCY_STAY_STATUSES,
} from "@/lib/booking-stats";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";
import QuickDateFilter from "@/components/admin/quick-date-filter";
import FiltersBar from "./filters-bar";
import PaginationBar from "@/components/pagination-bar";
import { parsePageParams } from "@/lib/pagination";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("bookings")} — Villa Go` };
}


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

// 상태 필터 카드(대시보드 스타일) 아이콘 — 탭 키 ↔ Material Symbol + 색
const TAB_ICON: Record<string, string> = {
  all: "apps",
  hold: "hourglass_top",
  confirmed: "check_circle",
  checkedin: "login",
  checkedout: "logout",
  closed: "cancel",
};
const TAB_ICON_CLASS: Record<string, string> = {
  all: "text-slate-400",
  hold: "text-amber-500",
  confirmed: "text-admin-primary",
  checkedin: "text-indigo-400",
  checkedout: "text-slate-400",
  closed: "text-red-400",
};

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
    range?: string;
    from?: string;
    to?: string;
    dateBasis?: string;
    area?: string;
    villa?: string;
    channel?: string;
    seller?: string;
    q?: string;
    page?: string;
    pageSize?: string;
    filter?: string;
  }>;
}) {
  const t = await getTranslations("adminBookings");
  const ts = await getTranslations("adminCheckinSheet");
  // 코치마크 문구 — RSC 번역 → props (ADMIN_CLIENT_NAMESPACES 무변경)
  const tTour = await getTranslations("tour");
  // [S-RBAC-3 보강] STAFF 재무 마스킹 — 판매가(KRW/VND)는 canViewFinance만.
  // 목록 select에서 제외해야 RSC→클라(ResponsiveTable) 페이로드 누수도 차단(QA H-1).
  const session = await auth();
  const showFinance = canViewFinance(session?.user?.role);
  const params = await searchParams;
  const now = new Date();
  const today = todayInVillaTimezone(now);

  const tab = params.status && params.status in TAB_STATUSES ? params.status : "all";
  const defaultMonth = toDateOnlyString(today).slice(0, 7);
  const monthRange = parseMonth(params.month) ?? parseMonth(defaultMonth)!;
  const area = params.area?.trim() || undefined;
  const villaId = params.villa || undefined;
  const channel = CHANNELS.includes(params.channel as BookingChannel)
    ? (params.channel as BookingChannel)
    : undefined;
  // F10: 판매주체 필터 (전체/운영자/공급자). 운영자 전용 화면 — 직접예약 식별/조회.
  const seller =
    params.seller === BookingSeller.OPERATOR || params.seller === BookingSeller.SUPPLIER
      ? (params.seller as BookingSeller)
      : undefined;
  const preset =
    params.filter === "today-checkin" || params.filter === "today-checkout"
      ? params.filter
      : undefined;
  const { page, pageSize, skip, take } = parsePageParams(params);

  // 빠른 날짜 필터(range): 활성 시 checkIn 기준으로 월 겹침 조건을 대체.
  // undefined → 비활성('전체' 또는 월 로직 유지). preset이 있으면 무시(아래 분기에서 미사용).
  const dateWhere = quickRangeWhere(params.range, "date");

  // ── 날짜별 체크인/아웃/투숙 검색 (T-villa-search-expansion §B) ──
  // from/to 둘 다 유효하고 from ≤ to 일 때만 적용(단일일 허용, 한쪽만·역전이면 미적용 — 500 방지).
  // 우선순위: filter(프리셋) > from/to+basis > range > month. dateRangeActive 는 range·month 를 대체.
  const dateBasis: BookingDateBasis = resolveBookingDateBasis(params.dateBasis);
  const fromDate = params.from ? parseUtcDateOnly(params.from) : null;
  const toDate = params.to ? parseUtcDateOnly(params.to) : null;
  const dateRangeActive = !!(fromDate && toDate && fromDate.getTime() <= toDate.getTime());
  const basisWhere = dateRangeActive
    ? buildBookingDateBasisWhere(fromDate!, toDate!, dateBasis)
    : null;

  // q 확장 — guestPhone 검색(where 전용, rows select 미포함: PII).
  // ⚠ 저장 형식 실측: guestPhone 은 혼재 형식(하이픈·+·공백, 예 "+82-10-1234-5678"·"010-2345-6789")으로
  //   저장된다(입력 경로가 trim 만 — hold/supplier/modify). 로그인용 User.phone(숫자만)과 다르다.
  //   따라서 순수 숫자 입력("01023456789")을 하이픈 저장값에 매칭하려면 문자 제거 후 비교가 필요한데
  //   Prisma where 로는 컬럼 문자 제거가 불가하므로, q 숫자가 4자리 이상일 때만 정규화 LIKE 원시쿼리로
  //   매칭 booking id 를 구해 아래 q OR 에 접는다(ADMIN 게이트 RSC · where 전용). 프래그먼트("1234")는
  //   원시쿼리 없이도 { guestPhone: { contains: q } } 로 잡힌다.
  let phoneMatchIds: string[] = [];
  const q = params.q?.trim() || undefined;
  if (q) {
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 4) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Booking"
        WHERE regexp_replace(COALESCE("guestPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + digits + "%"}
      `;
      phoneMatchIds = rows.map((r) => r.id);
    }
  }

  // 기본 where(상태 제외) — 탭 건수도 이 기준으로 집계.
  // 프리셋(T2.6 링크 계약)은 월·탭을 대체한다 (오늘 = Asia/Ho_Chi_Minh 기준)
  const baseWhere: Prisma.BookingWhereInput = preset
    ? preset === "today-checkin"
      ? { checkIn: today, status: BookingStatus.CONFIRMED }
      : { checkOut: today, status: BookingStatus.CHECKED_IN }
    : {
        // 날짜 절: 우선순위 from/to(basisWhere) > range > month.
        //   basisWhere 활성 → 명시 날짜가 authoritative(HOLD 항상표시 OR 제거 — 계약 §B4).
        //   range 활성 → checkIn 범위 / 둘 다 비활성 → 월 겹침 + 활성 HOLD 항상 포함
        //   (A2: 다음달 체크인 가예약이 기본 화면·HOLD 탭에서 숨어 입금확인을 놓치는 사고 방지.
        //    q 검색이 최상위 OR 키를 쓰므로 충돌하지 않게 AND로 감싼다)
        ...(basisWhere
          ? basisWhere
          : dateWhere
            ? { checkIn: dateWhere }
            : {
                AND: [
                  {
                    OR: [
                      { checkIn: { lt: monthRange.end }, checkOut: { gt: monthRange.start } },
                      { status: BookingStatus.HOLD },
                    ],
                  },
                ],
              }),
        ...(villaId ? { villaId } : {}),
        // 지역(area) = 빌라 단지명(complex) 정확 일치 (재고 비공개 — villa 관계 필터)
        ...(area ? { villa: { is: { complex: area } } } : {}),
        ...(channel ? { channel } : {}),
        ...(seller ? { seller } : {}),
        ...(q
          ? {
              OR: [
                { guestName: { contains: q, mode: "insensitive" as const } },
                { id: { contains: q } },
                { agencyName: { contains: q, mode: "insensitive" as const } },
                { villa: { is: { name: { contains: q, mode: "insensitive" as const } } } },
                // guestPhone — 저장 형식대로의 부분일치(프래그먼트). where 전용(select 미포함).
                { guestPhone: { contains: q, mode: "insensitive" as const } },
                // 숫자 정규화(문자 제거) 후 매칭된 예약 id (순수 숫자 입력 대응). 없으면 미포함.
                ...(phoneMatchIds.length ? [{ id: { in: phoneMatchIds } }] : []),
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
        skip,
        take,
        select: {
          id: true,
          status: true,
          channel: true,
          seller: true, // F10: 직접예약 뱃지·식별 (점유 사실만 — 공급자 판매가 미포함)
          agencyName: true,
          guestName: true,
          checkIn: true,
          checkOut: true,
          nights: true,
          saleCurrency: true,
          // 판매가는 재무 권한자만 select (STAFF는 키 자체 부재 → 클라 페이로드 누수 0)
          ...(showFinance ? { totalSaleKrw: true, totalSaleVnd: true } : {}),
          holdExpiresAt: true,
          villa: { select: { name: true } },
          // 파트너 취소·변경·홀드연장 대기 요청 수 — 행 배지 (T-partner-admin-ops ②)
          _count: { select: { changeRequests: { where: { status: "PENDING" } } } },
        },
      }),
      prisma.booking.count({ where }),
      prisma.booking.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
      prisma.villa.findMany({
        where: { status: { in: [VillaStatus.ACTIVE, VillaStatus.INACTIVE] } },
        orderBy: [{ complex: "asc" }, { name: "asc" }],
        select: { id: true, name: true, complex: true },
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

  // 지역(area) 옵션 = 운영 대상 빌라의 단지명(complex) distinct, complex asc 정렬됨
  const areaOptions = Array.from(
    new Set(villas.map((v) => v.complex).filter((c): c is string => !!c))
  );

  // 상태 탭 링크 — 기존 searchParams 를 전부 복제한 뒤 status 만 조정한다(신규 from/to/dateBasis 유실 방지).
  //   status(아래서 설정)·page(1 리셋)·filter(프리셋과 상태 탭은 상호배타 — 탭 클릭 시 프리셋 해제)는 제외.
  const tabHref = (key: string) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      if (k === "status" || k === "page" || k === "filter") continue;
      next.set(k, v);
    }
    if (key !== "all") next.set("status", key);
    const qs = next.toString();
    return qs ? `/bookings?${qs}` : "/bookings";
  };

  // 날짜 스코프 배너 — "해제" 링크는 from/to/dateBasis 만 제거하고 나머지 필터·검색은 보존
  const scopeClearHref = (() => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      if (k === "from" || k === "to" || k === "dateBasis" || k === "page") continue;
      next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `/bookings?${qs}` : "/bookings";
  })();
  const fmtMD = (dt: Date) => `${dt.getUTCMonth() + 1}.${String(dt.getUTCDate()).padStart(2, "0")}`;

  type Row = (typeof rows)[number];
  const amountCell = (b: Row) => {
    // showFinance=false면 키 부재(union narrowing) — STAFF엔 amount 컬럼 자체를 안 그림
    const krw = "totalSaleKrw" in b ? b.totalSaleKrw : null;
    const vnd = "totalSaleVnd" in b ? b.totalSaleVnd : null;
    return b.saleCurrency === "KRW"
      ? `${formatThousands(krw ?? 0)}원`
      : `${formatThousands(vnd ?? 0n)}₫`;
  };

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

  // F10 공급자 직접예약 뱃지 — 타임라인 청록과 동계열. 점유 사실만(판매가 미표시).
  const directBadge = (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-500/15 border border-teal-500/30 text-teal-300 text-[10px] font-bold whitespace-nowrap">
      <span className="material-symbols-outlined text-[12px]">handshake</span>
      {t("list.directBadge")}
    </span>
  );

  const columns: ResponsiveColumn<Row>[] = [
    {
      key: "villa",
      header: t("list.columns.villa"),
      cell: (b) => (
        <span className="inline-flex items-center gap-2">
          <Link
            href={`/bookings/${b.id}`}
            className="text-sm font-semibold text-slate-200 whitespace-nowrap after:absolute after:inset-0"
          >
            {b.villa.name}
          </Link>
          {b.seller === BookingSeller.SUPPLIER && directBadge}
          {/* 파트너 요청 대기 배지 — 상세의 요청 패널로 진입 유도 (T-partner-admin-ops ②) */}
          {b._count.changeRequests > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold whitespace-nowrap">
              <span className="material-symbols-outlined text-[12px]">campaign</span>
              {t("list.requestBadge", { count: b._count.changeRequests })}
            </span>
          )}
        </span>
      ),
      hideOnCard: true, // 모바일은 cardSummary로 표시
    },
    {
      key: "guest",
      header: t("list.columns.guest"),
      cell: (b) => <span className="text-sm text-slate-300 whitespace-nowrap">{b.guestName}</span>,
      hideOnCard: true, // 모바일은 cardSummary로 표시
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
      hideOnCard: true, // 모바일은 cardSummary로 표시
    },
    // 판매가 컬럼 — 재무 권한자만 (STAFF 미표시)
    ...(showFinance
      ? [
          {
            key: "amount",
            header: t("list.columns.amount"),
            headerClassName: "text-right",
            className: "text-right",
            cell: (b: Row) => (
              <span className="text-sm font-bold text-slate-200 tabular-nums whitespace-nowrap">
                {amountCell(b)}
              </span>
            ),
            hideOnCard: true, // 모바일은 cardSummary로 표시
          },
        ]
      : []),
    {
      key: "status",
      header: t("list.columns.status"),
      headerClassName: "text-center",
      className: "text-center",
      cell: statusBadge,
      hideOnCard: true, // 모바일은 cardSummary로 표시
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{t("list.title")}</h1>
        <Link
          href="/bookings/checkin-sheet"
          // 코치마크 앵커 — 필터 스텝을 화면 고유 기능(체크인 시트 출력)으로 교체(T-7)
          data-tour="bookings-sheet"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-admin-primary text-white text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all"
        >
          <span className="material-symbols-outlined text-base">print</span>
          {ts("entryButton")}
        </Link>
      </div>

      {/* 상태 필터 카드 그리드 (대시보드 스타일) — 검색 상단에 개수 배지 카드로 표시 */}
      <div data-tour="bookings-status" className="grid grid-cols-3 lg:grid-cols-6 gap-2.5 lg:gap-3">
        {TAB_ORDER.map((key) => {
          const active = !preset && tab === key;
          return (
            <Link
              key={key}
              href={tabHref(key)}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "bg-admin-card p-3 rounded-xl border-2 border-admin-primary ring-1 ring-admin-primary/30 flex flex-col gap-1 transition-all"
                  : "bg-admin-card p-3 rounded-xl border border-slate-700/50 hover:ring-1 hover:ring-admin-primary/50 active:scale-[0.98] flex flex-col gap-1 transition-all"
              }
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`text-[10px] lg:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${
                    active ? "text-admin-primary" : "text-slate-400"
                  }`}
                >
                  {t(`list.tabs.${key}`)}
                </span>
                <span className={`material-symbols-outlined text-[18px] shrink-0 ${TAB_ICON_CLASS[key]}`}>
                  {TAB_ICON[key]}
                </span>
              </div>
              <span
                className={`text-2xl font-black tabular-nums ${active ? "text-white" : "text-slate-200"}`}
              >
                {countOf(TAB_STATUSES[key])}
              </span>
            </Link>
          );
        })}
      </div>

      {/* 필터 카드 (b5) */}
      <div className="bg-admin-card rounded-xl border border-slate-800/50 shadow-sm overflow-hidden">
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
          <>
            <div className="px-4 py-3 border-b border-slate-800">
              <QuickDateFilter
                presets={[
                  "all",
                  "today",
                  "yesterday",
                  "thisWeek",
                  "lastWeek",
                  "thisMonth",
                  "lastMonth",
                  "nextMonth",
                ]}
                // 빠른 범위(range) 선택 시 상위 우선순위 from/to/dateBasis 를 해제해 "나중 선택이 이기게" 한다
                clearKeys={["from", "to", "dateBasis"]}
              />
            </div>
            {/* 날짜별 검색 스코프 배너 — from/to 활성 시 한 줄로 노출 (계약 §B1) */}
            {dateRangeActive && fromDate && toDate && (
              <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2 bg-admin-primary/5">
                <span className="material-symbols-outlined text-admin-primary text-base">event</span>
                <span className="text-sm text-slate-300 font-medium">
                  {t("list.dateScope.label", {
                    from: fmtMD(fromDate),
                    to: fmtMD(toDate),
                    basis: t(`list.dateBasis.${dateBasis}`),
                  })}
                </span>
                <Link
                  href={scopeClearHref}
                  className="ml-1 text-sm text-slate-400 hover:text-white underline whitespace-nowrap"
                >
                  {t("list.dateScope.clear")}
                </Link>
              </div>
            )}
            <FiltersBar villas={villas} areas={areaOptions} />
          </>
        )}
      </div>

      {/* 테이블 (≥768px) / 카드 (<768px) — T6.7 */}
      {/* 코치마크 앵커 — 공용 ResponsiveTable 무수정: 래퍼가 데스크톱 표/모바일 카드 이중 렌더를 단일 앵커로 흡수 */}
      <div data-tour="bookings-list">
      <ResponsiveTable
        columns={columns}
        rows={rows}
        rowKey={(b) => b.id}
        rowClassName={(b) =>
          b.status === BookingStatus.EXPIRED ? "relative opacity-60" : "relative"
        }
        emptyMessage={t("list.empty")}
        cardSummary={(b) => (
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-slate-200 truncate">{b.villa.name}</span>
                {b.seller === BookingSeller.SUPPLIER && directBadge}
              </span>
              {statusBadge(b)}
            </div>
            <span className="text-sm text-slate-300 truncate">{b.guestName}</span>
            <span className="text-xs text-slate-400 tabular-nums">
              {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)} · {t("list.card.nights", { n: b.nights })}
              {showFinance ? ` · ${amountCell(b)}` : ""}
            </span>
          </div>
        )}
        cardFooter={(b) => (
          <Link
            href={`/bookings/${b.id}`}
            className="mt-1 flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg bg-admin-primary/10 border border-admin-primary/30 text-admin-primary text-sm font-bold hover:bg-admin-primary/20 transition-colors"
          >
            {t("list.card.viewDetail")}
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </Link>
        )}
      />
      </div>

      {/* 페이지네이션 — 행 수 요약 + 페이지당 개수(10/20/30/50/100) + 숫자 페이지 */}
      <PaginationBar total={total} page={page} pageSize={pageSize} />

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
        <Link
          href="/bookings?status=hold"
          className="bg-admin-card p-4 rounded-xl border border-slate-800/50 flex flex-col gap-1 hover:ring-1 hover:ring-amber-500 transition-all"
        >
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest whitespace-nowrap">
            {t("stats.pendingHolds")}
          </p>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-black text-amber-500 tabular-nums">{holdCount}</span>
            <span className="text-xs text-amber-500/80 font-medium whitespace-nowrap">
              {t("stats.pendingHoldsHint")}
            </span>
          </div>
        </Link>
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

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 "?"로 재생 (T-tutorial-onboarding-5) */}
      <CoachMark
        tourId="adminBookings"
        steps={buildTourSteps(tTour, "adminBookings")}
        labels={buildTourLabels(tTour)}
      />
    </div>
  );
}
