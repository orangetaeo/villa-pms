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
import PaginationBar from "@/components/pagination-bar";
import VillaReceivablesSelect from "./villa-receivables-select";
import StatsSection from "@/components/supplier/stats/stats-section";

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** @db.Date(UTC 자정) → "dd/MM" (a7 표기: 15/07) */
function formatDayMonth(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/** @db.Date(UTC 자정) → "dd/MM/yyyy" — 빌라 상세는 전 기간이라 연도까지 표기 */
function formatUtcDmy(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
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
    villa?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const locale = await getSupplierLocale(session.user.locale);
  const tSeg = await getTranslations({ locale, namespace: "supplierStats" });

  const params = await searchParams;
  const { yearMonth: yearMonthParam, view, range, villa: villaParam } = params;
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
          villaParam={villaParam}
          page={page}
          pageSize={pageSize}
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
  villaParam,
  page,
  pageSize,
}: {
  locale: string;
  supplierId: string;
  yearMonthParam?: string;
  villaParam?: string;
  page: number;
  pageSize: number;
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
        seller: true, // 판매 채널 — OPERATOR(우리회사)/SUPPLIER(직접). 배지·미수 분류용
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
    // 미수/입금 집계 + 빌라 드릴다운 — 전 기간 정산 대상 예약(원가·기간·빌라).
    prisma.booking.findMany({
      where: {
        status: { in: [...SETTLEMENT_BOOKING_STATUSES] },
        villa: { supplierId },
      },
      orderBy: { checkOut: "desc" }, // 빌라 상세 = 최신순
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        supplierCostVnd: true,
        seller: true,
        villaId: true,
        villa: { select: { name: true, nameVi: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { supplierId },
      select: { yearMonth: true, status: true },
    }),
  ]);

  // 미수/입금 현황(전 기간) — 받음(PAID 월)·미수(미PAID 월)·미납 달 목록·빌라별 분해.
  //   빌라명은 운영자/공급자 공통 병기명으로 표시(formatVillaName)
  const recv = summarizeSupplierReceivables(
    allBookings.map((b) => ({
      checkOut: b.checkOut,
      supplierCostVnd: b.supplierCostVnd,
      villaId: b.villaId,
      villaName: formatVillaName({ name: b.villa.name, nameVi: b.villa.nameVi }),
      seller: b.seller,
    })),
    allSettlements
  );

  // 월 합계 — BigInt 합산 (Number 변환 금지)
  const totalVnd = bookings.reduce((sum, b) => sum + b.supplierCostVnd, 0n);
  // 수익 상세(월별 예약 목록) 페이지네이션 — 메모리 슬라이스
  const pagedBookings = bookings.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // ── 빌라 드릴다운 (테오 요청: 검색→빌라 선택→그 빌라의 언제·얼마·결과) ──────────
  // 지급 완료(PAID)된 월 집합 — 예약별 결과(지급완료/대기) 판정용
  const paidMonths = new Set(
    allSettlements.filter((s) => s.status === SettlementStatus.PAID).map((s) => s.yearMonth)
  );
  // 셀렉터 옵션 (recv.byVilla = 미수 큰 순 → 드롭다운도 미수 빌라가 위). 옵션은 빌라명만.
  const villaOptions = recv.byVilla.map((v) => ({
    id: v.villaId,
    label: v.villaName, // 옵션은 빌라명만. 미수 금액 등은 선택 후 상세에서 표시
    hasOutstanding: v.outstandingVnd > 0n, // 미수/지급 필터용
  }));
  // 선택된 빌라 — 본인 소유(byVilla에 존재)인 경우만 유효
  const selectedVilla = villaParam ? recv.byVilla.find((v) => v.villaId === villaParam) : undefined;
  const selectedVillaId = selectedVilla?.villaId;
  // 선택 빌라의 예약(전 기간·최신순) → 결과(지급완료/대기) 부여 → 페이지네이션
  const villaBookings = selectedVillaId
    ? allBookings
        .filter((b) => b.villaId === selectedVillaId)
        .map((b) => ({
          id: b.id,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          nights: b.nights,
          supplierCostVnd: b.supplierCostVnd,
          direct: b.seller === "SUPPLIER", // 직접 판매(자체 수금)
          paid: b.seller === "OPERATOR" && paidMonths.has(b.checkOut.toISOString().slice(0, 7)),
        }))
    : [];
  const pagedVillaBookings = villaBookings.slice(
    (page - 1) * pageSize,
    (page - 1) * pageSize + pageSize
  );

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
        {/* 십억대 VND가 한 칸에 안 들어가 겹치던 3칸 그리드 → 세로 리스트(라벨 좌·금액 우정렬, full-width) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5">
            <span className="shrink-0 text-xs font-medium text-slate-500">{t("recvTotal")}</span>
            <span className="min-w-0 truncate text-right text-base font-extrabold tabular-nums text-slate-800">
              {formatVndDot(recv.totalVnd)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3.5 py-2.5">
            <span className="shrink-0 text-xs font-medium text-emerald-600">{t("recvPaid")}</span>
            <span className="min-w-0 truncate text-right text-base font-extrabold tabular-nums text-emerald-700">
              {formatVndDot(recv.paidVnd)}
            </span>
          </div>
          <div
            className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 ${
              recv.outstandingVnd > 0n ? "bg-amber-50" : "bg-slate-50"
            }`}
          >
            <span
              className={`shrink-0 text-xs font-medium ${
                recv.outstandingVnd > 0n ? "text-amber-600" : "text-slate-400"
              }`}
            >
              {t("recvOutstanding")}
            </span>
            <span
              className={`min-w-0 truncate text-right text-base font-extrabold tabular-nums ${
                recv.outstandingVnd > 0n ? "text-amber-700" : "text-slate-500"
              }`}
            >
              {formatVndDot(recv.outstandingVnd)}
            </span>
          </div>
          {/* 직접 판매(자체 수금) — 우리에게 받을 게 아님. 채널 구분 표시(테오 요청). 있을 때만 */}
          {recv.directVnd > 0n && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-indigo-50 px-3.5 py-2.5">
              <span className="shrink-0 text-xs font-medium text-indigo-600">{t("recvDirect")}</span>
              <span className="min-w-0 truncate text-right text-base font-extrabold tabular-nums text-indigo-700">
                {formatVndDot(recv.directVnd)}
              </span>
            </div>
          )}
        </div>
        {recv.directVnd > 0n && (
          <p className="text-[11px] leading-snug text-slate-400">{t("recvChannelNote")}</p>
        )}

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

      {/* 빌라별 조회 — 셀렉터로 빌라 선택 → 그 빌라 상세(언제·얼마·결과). 테오 요청 */}
      {villaOptions.length > 0 && (
        <VillaReceivablesSelect
          villas={villaOptions}
          selectedVillaId={selectedVillaId}
          labels={{
            title: t("recvByVillaTitle"),
            placeholder: t("villaSelectPlaceholder"),
            all: t("villaFilterAll"),
            outstanding: t("recvOutstanding"),
            paid: t("villaFilterPaid"),
          }}
        />
      )}

      {/* 빌라 선택 시 → 그 빌라의 상세(언제·얼마·결과) / 미선택 시 → 기존 월별 뷰 */}
      {selectedVilla ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-lg font-bold text-slate-800">
              {selectedVilla.villaName}
            </h3>
            <Link
              href="/earnings?view=detail"
              className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
              {t("villaClear")}
            </Link>
          </div>
          {/* 선택 빌라 받음/미수 요약 */}
          <div className="flex gap-2">
            <div className="flex-1 rounded-xl bg-emerald-50 px-3 py-2 text-center">
              <p className="text-[11px] font-medium text-emerald-600">{t("recvPaid")}</p>
              <p className="text-sm font-extrabold tabular-nums text-emerald-700">
                {formatVndDot(selectedVilla.paidVnd)}
              </p>
            </div>
            <div
              className={`flex-1 rounded-xl px-3 py-2 text-center ${
                selectedVilla.outstandingVnd > 0n ? "bg-amber-50" : "bg-slate-50"
              }`}
            >
              <p
                className={`text-[11px] font-medium ${
                  selectedVilla.outstandingVnd > 0n ? "text-amber-600" : "text-slate-400"
                }`}
              >
                {t("recvOutstanding")}
              </p>
              <p
                className={`text-sm font-extrabold tabular-nums ${
                  selectedVilla.outstandingVnd > 0n ? "text-amber-700" : "text-slate-500"
                }`}
              >
                {formatVndDot(selectedVilla.outstandingVnd)}
              </p>
            </div>
          </div>
          {/* 예약별 상세 — 언제(체크인~아웃)·박수·얼마·결과(지급완료/대기) */}
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-700">{t("villaRecordsTitle")}</h4>
            <span className="rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">
              {t("transactionCount", { count: villaBookings.length })}
            </span>
          </div>
          {villaBookings.length === 0 ? (
            <p className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-400">
              {t("empty")}
            </p>
          ) : (
            <div className="space-y-3">
              {pagedVillaBookings.map((b) => (
                <div
                  key={b.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border-l-4 bg-white p-4 shadow-sm ${
                    b.direct ? "border-indigo-400" : b.paid ? "border-emerald-500" : "border-amber-400"
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-slate-700 tabular-nums">
                      {formatUtcDmy(b.checkIn)} – {formatUtcDmy(b.checkOut)}
                    </p>
                    <p className="text-xs text-slate-400">{t("nights", { count: b.nights })}</p>
                    <div className="flex flex-wrap items-center gap-1">
                      {/* 판매 채널 배지 — 직접판매 / 우리회사 */}
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold ${
                          b.direct ? "bg-indigo-100 text-indigo-700" : "bg-teal-100 text-teal-700"
                        }`}
                      >
                        {b.direct ? t("channelDirect") : t("channelOperator")}
                      </span>
                      {/* 결과 — 직접판매는 자체수금이라 지급상태 없음 */}
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          b.direct
                            ? "bg-slate-100 text-slate-500"
                            : b.paid
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {b.direct ? t("channelSelfCollected") : b.paid ? t("paidLabel") : t("pendingLabel")}
                      </span>
                    </div>
                  </div>
                  <p
                    className={`shrink-0 text-lg font-bold tabular-nums ${
                      b.direct ? "text-indigo-700" : b.paid ? "text-teal-700" : "text-slate-600"
                    }`}
                  >
                    {formatVndDot(b.supplierCostVnd)}
                  </p>
                </div>
              ))}
              <PaginationBar total={villaBookings.length} page={page} pageSize={pageSize} light />
            </div>
          )}
        </section>
      ) : (
        <>
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
          {pagedBookings.map((booking) => {
            const direct = booking.seller === "SUPPLIER";
            const bookingPaid = !direct && isPaid;
            return (
            <div
              key={booking.id}
              className={`flex items-center justify-between rounded-xl border-l-4 bg-white p-4 shadow-sm ${
                direct ? "border-indigo-400" : bookingPaid ? "border-emerald-500" : "border-slate-300"
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
                <div className="flex flex-wrap items-center gap-1">
                  {/* 판매 채널 */}
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold ${
                      direct ? "bg-indigo-100 text-indigo-700" : "bg-teal-100 text-teal-700"
                    }`}
                  >
                    {direct ? t("channelDirect") : t("channelOperator")}
                  </span>
                  {/* 결과 */}
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                      direct
                        ? "bg-slate-100 text-slate-500"
                        : bookingPaid
                          ? "bg-emerald-100 text-emerald-700"
                          : "border border-slate-200 bg-slate-100 text-slate-500"
                    }`}
                  >
                    {direct ? t("channelSelfCollected") : bookingPaid ? t("paidLabel") : t("pendingLabel")}
                  </span>
                </div>
              </div>
              <p className={`text-lg font-bold ${direct ? "text-indigo-700" : bookingPaid ? "text-teal-700" : "text-slate-600"}`}>
                {formatVndDot(booking.supplierCostVnd)}
              </p>
            </div>
            );
          })}
          {/* 수익 상세 페이지네이션 (라이트) — 합계는 전체 기준 */}
          <PaginationBar total={bookings.length} page={page} pageSize={pageSize} light />
        </div>
      )}
        </>
      )}
    </div>
  );
}
