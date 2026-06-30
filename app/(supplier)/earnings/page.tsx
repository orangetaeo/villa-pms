// SUPPLIER 수익·통계 (T4.5/T-supplier-statistics, SPEC F6) — design/stitch a7-my-earnings·a8-my-statistics
// 마진 비공개 원칙: select·집계는 빌라명·기간·박수·supplierCostVnd만 —
// 판매가(KRW/VND)·마진·고객명·연락처는 조회 자체를 하지 않는다.
// 상단 세그먼트: 통계(기본) | 정산 내역. 통계=StatsSection, 정산내역=월별 내역(기존).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { SettlementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SETTLEMENT_BOOKING_STATUSES, monthRangeUtc } from "@/lib/settlement";
import { todayVnDateString } from "@/lib/date-vn";
import { formatVillaName } from "@/lib/villa-name";
import { formatVndDot } from "@/lib/format";
import { parsePageParams } from "@/lib/pagination";
import { summarizeSupplierReceivables } from "@/lib/supplier-receivables";
import StatsSection from "@/components/supplier/stats/stats-section";

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** @db.Date(UTC 자정) → "dd/MM" (a7 표기: 15/07) */
function formatDayMonth(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/** "YYYY-MM" ± delta개월 — Date.UTC 롤오버로 연 경계 처리 */
function shiftMonth(yearMonth: string, delta: number): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** paidAt 타임스탬프 → dd/MM/yyyy (Asia/Ho_Chi_Minh 표시 규칙) */
function formatPaidDate(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export const metadata: Metadata = {
  title: "Thu nhập — Villa Go",
};

export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<{
    yearMonth?: string;
    view?: string;
    range?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const tSeg = await getTranslations({ locale, namespace: "supplierStats" });

  const params = await searchParams;
  const { yearMonth: yearMonthParam, view, range } = params;
  const isDetail = view === "detail";
  // 빌라별 성과 리스트 페이지네이션 (통계 탭) — 공용 page/pageSize 쿼리
  const { page, pageSize } = parsePageParams(params);

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-6">
      {/* 세그먼트 컨트롤 — 통계 | 정산 내역 */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        <Link
          href="/earnings?view=stats"
          aria-current={!isDetail ? "page" : undefined}
          className={
            !isDetail
              ? "rounded-lg bg-white py-2 text-center text-sm font-bold text-teal-700 shadow-sm"
              : "rounded-lg py-2 text-center text-sm font-medium text-slate-500"
          }
        >
          {tSeg("segStats")}
        </Link>
        <Link
          href="/earnings?view=detail"
          aria-current={isDetail ? "page" : undefined}
          className={
            isDetail
              ? "rounded-lg bg-white py-2 text-center text-sm font-bold text-teal-700 shadow-sm"
              : "rounded-lg py-2 text-center text-sm font-medium text-slate-500"
          }
        >
          {tSeg("segDetail")}
        </Link>
      </div>

      {isDetail ? (
        <EarningsDetail
          locale={locale}
          supplierId={session.user.id}
          yearMonthParam={yearMonthParam}
        />
      ) : (
        <StatsSection
          supplierId={session.user.id}
          locale={locale}
          range={range}
          page={page}
          pageSize={pageSize}
        />
      )}
    </main>
  );
}

// ── 정산 내역(기존 월별 화면) — view=detail ──────────────────────────
async function EarningsDetail({
  locale,
  supplierId,
  yearMonthParam,
}: {
  locale: string;
  supplierId: string;
  yearMonthParam?: string;
}) {
  const t = await getTranslations({ locale, namespace: "earnings" });

  // 월 선택 — 기본 이번 달(Asia/Ho_Chi_Minh), 형식 오류는 이번 달 폴백 (calendar 패턴)
  const currentMonth = todayVnDateString().slice(0, 7);
  const yearMonth =
    yearMonthParam && YEAR_MONTH_RE.test(yearMonthParam) ? yearMonthParam : currentMonth;
  const { start, end } = monthRangeUtc(yearMonth); // 체크아웃 월 기준 (lib/settlement 단일 소스)

  // 자기 빌라 예약만 — villa.supplierId = 세션 사용자 강제 (세션 외 입력 사용 금지).
  //   ① 선택 월 상세 ② 선택 월 정산 레코드 ③ 전 기간 예약(미수 집계) ④ 전 기간 정산(PAID 분류)
  const [bookings, settlement, allBookings, allSettlements] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: { in: [...SETTLEMENT_BOOKING_STATUSES] }, // CHECKED_OUT·NO_SHOW
        checkOut: { gte: start, lt: end },
        villa: { supplierId },
      },
      orderBy: { checkIn: "asc" },
      // 마진 비공개 — 원가·기간·빌라명만 select (판매가·마진·고객 필드 비조회)
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        supplierCostVnd: true,
        villa: { select: { name: true, nameVi: true } },
      },
    }),
    prisma.settlement.findUnique({
      where: {
        supplierId_yearMonth: { supplierId, yearMonth },
      },
      // statementUrl 존재 시 정산서 PDF 보기 버튼 노출 (GET /api/settlements/[id]/statement는 소유 공급자 허용)
      select: { id: true, status: true, paidAt: true, statementUrl: true },
    }),
    // 미수/입금 집계용 — 전 기간 정산 대상 예약(원가·체크아웃월만)
    prisma.booking.findMany({
      where: {
        status: { in: [...SETTLEMENT_BOOKING_STATUSES] },
        villa: { supplierId },
      },
      select: { checkOut: true, supplierCostVnd: true },
    }),
    prisma.settlement.findMany({
      where: { supplierId },
      select: { yearMonth: true, status: true },
    }),
  ]);

  // 미수/입금 현황(전 기간) — 받음(PAID 월)·미수(미PAID 월)·미납 달 목록
  const recv = summarizeSupplierReceivables(allBookings, allSettlements);

  // 월 합계 — BigInt 합산 (Number 변환 금지)
  const totalVnd = bookings.reduce((sum, b) => sum + b.supplierCostVnd, 0n);

  // 정산 상태 파생 — DRAFT·CONFIRMED·미생성 → 지급 대기 / PAID → 지급 완료(+일자)
  const isPaid = settlement?.status === SettlementStatus.PAID;
  const paidVnd = isPaid ? totalVnd : 0n;
  const pendingVnd = isPaid ? 0n : totalVnd;

  const monthNum = Number(yearMonth.slice(5, 7));
  const yearNum = Number(yearMonth.slice(0, 4));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">{t("title")}</h1>

      {/* 미수/입금 현황 (전 기간 누적) — "받았는지·못 받은 미수 없는지" 한눈에. 마진·판매가 없음 */}
      <section className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
          <span className="material-symbols-outlined text-[18px] text-teal-600">account_balance_wallet</span>
          {t("recvTitle")}
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="text-[11px] font-medium text-slate-400">{t("recvTotal")}</p>
            <p className="mt-0.5 text-sm font-extrabold tabular-nums text-slate-800">
              {formatVndDot(recv.totalVnd)}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center">
            <p className="text-[11px] font-medium text-emerald-600">{t("recvPaid")}</p>
            <p className="mt-0.5 text-sm font-extrabold tabular-nums text-emerald-700">
              {formatVndDot(recv.paidVnd)}
            </p>
          </div>
          <div
            className={`rounded-xl p-3 text-center ${
              recv.outstandingVnd > 0n ? "bg-amber-50" : "bg-slate-50"
            }`}
          >
            <p
              className={`text-[11px] font-medium ${
                recv.outstandingVnd > 0n ? "text-amber-600" : "text-slate-400"
              }`}
            >
              {t("recvOutstanding")}
            </p>
            <p
              className={`mt-0.5 text-sm font-extrabold tabular-nums ${
                recv.outstandingVnd > 0n ? "text-amber-700" : "text-slate-500"
              }`}
            >
              {formatVndDot(recv.outstandingVnd)}
            </p>
          </div>
        </div>

        {/* 미납 달 목록 — 있으면 그 달 상세로 이동. 없으면 전액 수령 안내 */}
        {recv.unpaidMonths.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {t("recvUnpaidTitle")}
            </p>
            {recv.unpaidMonths.map((m) => (
              <Link
                key={m.yearMonth}
                href={`/earnings?view=detail&yearMonth=${m.yearMonth}`}
                className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2.5 transition-colors hover:bg-amber-50 active:scale-[0.99]"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <span className="material-symbols-outlined text-[16px] text-amber-500">schedule</span>
                  {t("monthLabel", {
                    month: Number(m.yearMonth.slice(5, 7)),
                    year: Number(m.yearMonth.slice(0, 4)),
                  })}
                  <span className="text-xs text-amber-600">· {t("pendingLabel")}</span>
                </span>
                <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-amber-700">
                  {formatVndDot(m.amountVnd)}
                  <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          recv.totalVnd > 0n && (
            <p className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 py-2.5 text-xs font-medium text-emerald-700">
              <span className="material-symbols-outlined text-base">check_circle</span>
              {t("recvAllPaid")}
            </p>
          )
        )}
      </section>

      {/* 월 선택 (a7 Month Selector) — ?view=detail&yearMonth= Link 네비게이션 */}
      <section className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
        <Link
          href={`/earnings?view=detail&yearMonth=${shiftMonth(yearMonth, -1)}`}
          aria-label={t("prevMonth")}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-600 transition-all active:scale-90"
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </Link>
        <div className="flex flex-col items-center">
          <span className="text-sm font-medium uppercase tracking-wider text-slate-400">
            {t("periodLabel")}
          </span>
          <span className="font-bold text-teal-900">
            {t("monthLabel", { month: monthNum, year: yearNum })}
          </span>
        </div>
        <Link
          href={`/earnings?view=detail&yearMonth=${shiftMonth(yearMonth, 1)}`}
          aria-label={t("nextMonth")}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-600 transition-all active:scale-90"
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </Link>
      </section>

      {/* 월 합계 카드 (a7 Summary Card) */}
      <section className="relative overflow-hidden rounded-2xl bg-teal-600 p-6 text-white shadow-xl">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-teal-500 opacity-20" />
        <div className="relative z-10 space-y-4">
          <div>
            <p className="text-sm font-medium text-teal-50 opacity-90">{t("totalTitle")}</p>
            <h2 className="mt-1 text-4xl font-extrabold tracking-tight">
              {formatVndDot(totalVnd)}
            </h2>
          </div>
          <div className="h-px w-full bg-white/20" />
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-teal-50">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>
                {t("paidLabel")}: {formatVndDot(paidVnd)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full border border-white/40 bg-teal-200/50" />
              <span>
                {t("pendingLabel")}: {formatVndDot(pendingVnd)}
              </span>
            </div>
          </div>
          {isPaid && settlement?.paidAt && (
            <p className="text-xs font-medium text-emerald-200">
              {t("paidOn", { date: formatPaidDate(settlement.paidAt) })}
            </p>
          )}
        </div>
      </section>

      {/* 정산서 PDF — 운영자가 발행(statementUrl)한 경우에만 노출. 새 탭으로 inline PDF.
          미발행 시 안내 문구만(공급자는 직접 생성 불가 — 정산 확정 시 운영자 발행). */}
      {settlement?.statementUrl ? (
        <a
          href={`/api/settlements/${settlement.id}/statement`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 py-3 text-sm font-bold text-teal-700 transition-colors hover:bg-teal-100 active:scale-[0.99]"
        >
          <span className="material-symbols-outlined text-lg">description</span>
          {t("viewStatement")}
        </a>
      ) : (
        bookings.length > 0 && (
          <p className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50 py-3 text-xs text-slate-400">
            <span className="material-symbols-outlined text-base">schedule</span>
            {t("statementPending")}
          </p>
        )
      )}

      {/* 내역 헤더 (a7 Earnings List Header) */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800">{t("listTitle")}</h3>
        <span className="rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">
          {t("transactionCount", { count: bookings.length })}
        </span>
      </div>

      {/* 예약별 내역 (a7 Earnings List) — 행 상태색은 월 정산 status에서 파생 */}
      {bookings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white p-10 text-center shadow-sm">
          <span className="material-symbols-outlined text-5xl text-teal-600">payments</span>
          <p className="text-sm font-bold text-slate-700">{t("empty")}</p>
          <p className="text-sm text-slate-500">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <div
              key={booking.id}
              className={`flex items-center justify-between rounded-xl border-l-4 bg-white p-4 shadow-sm ${
                isPaid ? "border-emerald-500" : "border-slate-300"
              }`}
            >
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900">
                  {formatVillaName({ name: booking.villa.name, nameVi: booking.villa.nameVi })}
                </h4>
                <p className="text-sm text-slate-500">
                  {formatDayMonth(booking.checkIn)} - {formatDayMonth(booking.checkOut)} (
                  {t("nights", { count: booking.nights })})
                </p>
                <span
                  className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                    isPaid
                      ? "bg-emerald-100 text-emerald-700"
                      : "border border-slate-200 bg-slate-100 text-slate-500"
                  }`}
                >
                  {isPaid ? t("paidLabel") : t("pendingLabel")}
                </span>
              </div>
              <p className={`text-lg font-bold ${isPaid ? "text-teal-700" : "text-slate-600"}`}>
                {formatVndDot(booking.supplierCostVnd)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
