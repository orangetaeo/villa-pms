// /availability — 운영자 빌라별 공실 보드 (T-admin-availability-board, Stitch b11 변환)
// RSC: prisma 직접 조회 (가용성 집계는 lib/availability.ts 단일 소스). (admin) 레이아웃 가드 하 ADMIN 전용.
// ⚠ 재고/마진 비공개: SUPPLIER 빌라는 CalendarBlock(MANUAL/ICAL) 잠금·공실만 다룬다.
//   DIRECT(직접공급) 빌라만 우리 판매예약을 BOOKING 셀로 표시하고, 판매가는 canViewFinance 게이트로 가린다.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { VillaStatus } from "@prisma/client";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAvailabilityBoard } from "@/lib/availability";
import { todayVnDateString } from "@/lib/date-vn";
import AvailabilityBoardClient, {
  type BoardColumn,
  type BoardMonthGroup,
  type BoardRow,
  type BoardStrings,
} from "./board-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("availability")} — Villa Go` };
}

const MONTH_COUNT = 3;
/** 마지막 확인일이 이 일수보다 오래되면 "확인 필요" — b11 NOTES 임계 규칙(14일) */
const STALE_DAYS = 14;

/** "YYYY-MM" 유효성 + 정규화. 무효면 null */
function normalizeMonth(m: string | undefined): string | null {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return null;
  const mm = Number(m.slice(5, 7));
  if (mm < 1 || mm > 12) return null;
  return m;
}

/** startMonth 기준 monthCount 개월 뒤 마지막 월 "YYYY-MM" */
function lastMonthOf(startMonth: string, count: number): string {
  const y = Number(startMonth.slice(0, 4));
  const m = Number(startMonth.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + count - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" → 이동 (delta 개월) */
function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{
    startMonth?: string;
    area?: string;
    search?: string;
    needCheck?: string;
  }>;
}) {
  const t = await getTranslations("availabilityBoard");
  const params = await searchParams;

  const todayStr = todayVnDateString();
  const defaultMonth = todayStr.slice(0, 7);
  // 과거 기간 URL 진입 방지 — startMonth 가 현재월보다 과거면 현재월로 클램프
  const rawStartMonth = normalizeMonth(params.startMonth) ?? defaultMonth;
  const startMonth = rawStartMonth < defaultMonth ? defaultMonth : rawStartMonth;
  const area = params.area?.trim() || undefined;
  const search = params.search?.trim() || undefined;
  const needCheckOnly = params.needCheck === "1";

  // S-RBAC-3: DIRECT 빌라 예약 셀의 판매가(KRW/VND)는 canViewFinance(OWNER/MANAGER/ADMIN)만.
  // STAFF 면 false → 집계 단계에서 판매가가 select·전송에서 제외된다 (1차 서버 방어).
  const session = await auth();
  const showFinance = canViewFinance(session?.user?.role);

  // 지역(area) 옵션 = 운영 대상 빌라의 complex distinct (재고 비공개 — 운영 대상만)
  const [board, complexRows] = await Promise.all([
    getAvailabilityBoard(prisma, {
      startMonth,
      monthCount: MONTH_COUNT,
      area,
      search,
      minDate: todayStr, // 과거 컬럼 제거 (BE 클램프, columns·days 인덱스 1:1 유지)
      canViewFinance: showFinance,
    }),
    prisma.villa.findMany({
      where: {
        status: { in: [VillaStatus.ACTIVE, VillaStatus.INACTIVE] },
        complex: { not: null },
      },
      distinct: ["complex"],
      orderBy: { complex: "asc" },
      select: { complex: true },
    }),
  ]);
  const areaOptions = complexRows
    .map((r) => r.complex)
    .filter((c): c is string => !!c);

  // ── 컬럼 → 월 그룹 + 일/요일/오늘/주말/월시작 플래그 ──
  const columns: BoardColumn[] = board.columns.map((iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일 … 6=토
    return {
      iso,
      day: d,
      dow,
      isWeekend: dow === 0 || dow === 6,
      isToday: iso === todayStr,
    };
  });
  // 월 그룹 (colspan 계산 + 헤더 라벨)
  const monthGroups: BoardMonthGroup[] = [];
  for (const col of columns) {
    const ym = col.iso.slice(0, 7);
    const last = monthGroups[monthGroups.length - 1];
    if (!last || last.ym !== ym) {
      const [yy, mm] = ym.split("-").map(Number);
      monthGroups.push({
        ym,
        label: t("periodMonth", { year: yy, month: mm }),
        span: 1,
        startIndex: monthGroups.reduce((n, g) => n + g.span, 0),
      });
    } else {
      last.span += 1;
    }
  }
  // 월 시작 컬럼 표시 (month-edge)
  const monthStartIso = new Set(monthGroups.map((g) => columns[g.startIndex].iso));
  for (const col of columns) col.isMonthStart = monthStartIso.has(col.iso);

  // ── 행(빌라) + 확인 필요 판정 ──
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const fmtMd = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  let needCheckCount = 0;
  const allRows: BoardRow[] = board.villas.map((v) => {
    const checked = v.availabilityCheckedAt;
    const isStale = !checked || new Date(checked) < staleBefore;
    if (isStale) needCheckCount += 1;
    return {
      id: v.id,
      name: v.name,
      complex: v.complex,
      checkedLabel: checked ? fmtMd(checked.slice(0, 10)) : null,
      needCheck: isStale,
      days: v.days,
    };
  });
  const rows = needCheckOnly ? allRows.filter((r) => r.needCheck) : allRows;

  const periodLabel = t("period", {
    start: t("periodMonth", {
      year: Number(startMonth.slice(0, 4)),
      month: Number(startMonth.slice(5, 7)),
    }),
    end: (() => {
      const lm = lastMonthOf(startMonth, MONTH_COUNT);
      return t("periodMonth", {
        year: Number(lm.slice(0, 4)),
        month: Number(lm.slice(5, 7)),
      });
    })(),
  });

  // 클라이언트 컴포넌트는 (admin)/layout.tsx 메시지 화이트리스트에 없는 네임스페이스를
  // 쓸 수 없으므로(layout 수정 금지 구역), 필요한 문구를 서버에서 번역해 props 로 전달한다.
  const strings: BoardStrings = {
    villaCount: t("villaCount", { n: board.villas.length }),
    search: t("search"),
    area: t("area"),
    allAreas: t("allAreas"),
    needCheckOnly: t("needCheckOnly"),
    today: t("today"),
    prevPeriod: t("prevPeriod"),
    nextPeriod: t("nextPeriod"),
    legendAvailable: t("legend.available"),
    legendManual: t("legend.manual"),
    legendIcal: t("legend.ical"),
    legendBooking: t("legend.booking"),
    legendChecked: t("legend.checked"),
    legendNeedCheck: t("legend.needCheck"),
    badgeChecked: t("badge.checked", { date: "{date}" }),
    badgeNeedCheck: t("badge.needCheck", { date: "{date}" }),
    badgeNever: t("badge.never"),
    confirmCheck: t("confirmCheck"),
    empty: t("empty"),
    cellAvailable: t("cell.available"),
    cellManual: t("cell.manual"),
    cellIcal: t("cell.ical"),
    cellBooking: t("cell.booking"),
    // ── DIRECT 빌라 예약 팝오버 ──
    bkStatusHold: t("bookingPopover.statusHold"),
    bkStatusConfirmed: t("bookingPopover.statusConfirmed"),
    bkStatusCheckedIn: t("bookingPopover.statusCheckedIn"),
    bkNights: t("bookingPopover.nights", { n: "{n}" }),
    bkGuest: t("bookingPopover.guest"),
    bkGuestCount: t("bookingPopover.guestCount", { n: "{n}" }),
    bkChannel: t("bookingPopover.channel"),
    bkChannelTravel: t("bookingPopover.channelTravel"),
    bkChannelLand: t("bookingPopover.channelLand"),
    bkChannelDirect: t("bookingPopover.channelDirect"),
    bkCost: t("bookingPopover.cost"),
    bkSale: t("bookingPopover.sale"),
    bkDeposit: t("bookingPopover.deposit"),
    bkDepositNone: t("bookingPopover.depositNone"),
    bkDepositHeld: t("bookingPopover.depositHeld"),
    bkDepositRefunded: t("bookingPopover.depositRefunded"),
    bkDepositPartial: t("bookingPopover.depositPartial"),
    bkHoldExpires: t("bookingPopover.holdExpires", { time: "{time}" }),
    bkHoldExpired: t("bookingPopover.holdExpired"),
    bkOpenDetail: t("bookingPopover.openDetail"),
    weekdays: [0, 1, 2, 3, 4, 5, 6].map((i) =>
      t(`weekdays.${i}` as "weekdays.0")
    ),
    popStateLabel: t("popover.stateLabel"),
    popStateAvailable: t("popover.stateAvailable"),
    popStateManual: t("popover.stateManual"),
    popLock: t("popover.lock"),
    popUnlock: t("popover.unlock"),
    popProcessing: t("popover.processing"),
    popHint: t("popover.hint"),
    popConflict: t("popover.conflict"),
    popError: t("popover.error"),
    popClose: t("popover.close"),
    icalTitle: t("icalPopover.title"),
    icalDesc: t("icalPopover.desc"),
    icalInfo: t("icalPopover.info"),
    rangeDays: t("rangePopover.days", { n: "{n}" }),
    rangeDateRange: t("rangePopover.dateRange", { start: "{start}", end: "{end}" }),
    rangeSummary: t("rangePopover.summary", { lockable: "{lockable}", unlockable: "{unlockable}" }),
    rangeLock: t("rangePopover.lock", { n: "{n}" }),
    rangeUnlock: t("rangePopover.unlock", { n: "{n}" }),
    rangeHint: t("rangePopover.hint"),
    rangeProcessing: t("rangePopover.processing"),
    rangeError: t("rangePopover.error"),
    collapseList: t("collapseList"),
    expandList: t("expandList"),
    selectHint: t("selectHint"),
    rangeModeLabel: t("rangeModeLabel"),
    rangeModeHint: t("rangeModeHint"),
    rangeModeAnchorHint: t("rangeModeAnchorHint"),
  };

  return (
    <div className="space-y-4">
      {/* 타이틀 + 의도 + 확인 필요 요약 칩 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
          <p className="mt-1 text-xs text-slate-500 max-w-2xl">{t("subtitle")}</p>
        </div>
        {needCheckCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-400 whitespace-nowrap shrink-0">
            <span className="material-symbols-outlined text-[16px]">priority_high</span>
            {t("needCheckChip", { n: needCheckCount })}
          </div>
        )}
      </div>

      <AvailabilityBoardClient
        columns={columns}
        monthGroups={monthGroups}
        rows={rows}
        areaOptions={areaOptions}
        startMonth={startMonth}
        prevMonth={startMonth > defaultMonth ? shiftMonth(startMonth, -MONTH_COUNT) : null}
        nextMonth={shiftMonth(startMonth, MONTH_COUNT)}
        thisMonth={defaultMonth}
        periodLabel={periodLabel}
        area={area ?? ""}
        search={search ?? ""}
        needCheckOnly={needCheckOnly}
        strings={strings}
      />
    </div>
  );
}
