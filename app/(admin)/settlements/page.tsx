// /settlements — 운영자 월 정산 (T4.5, Stitch b7-settlements 변환, SPEC F6)
// RSC: prisma 직접 조회 (목록·상세 items·매출 요약). 집계·전이 액션만 BE API 소비.
// 매출 요약은 통화별 분리(KRW/VND 합산 금지 — ADR-0003), 공급자 지급은 VND 단일.
// 금액: BigInt → 문자열 → lib/format (Number() 캐스팅 금지 — money-pattern)
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { canViewFinance } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatThousands, formatVnd, formatDateTime } from "@/lib/format";
import { toDateOnlyString, todayVnDateString, resolveQuickRange } from "@/lib/date-vn";
import { monthRangeUtc, SETTLEMENT_BOOKING_STATUSES } from "@/lib/settlement";
import { summarizeFinance, type FinanceBooking } from "@/lib/settlement-finance";
import SettlementsView, { type SettlementRow } from "./settlements-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("settlements")} — Villa PMS` };
}

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ yearMonth?: string; range?: string }>;
}) {
  // 재무 권한자(OWNER/MANAGER) 가드 — 정산=매출·지급(ADR-0013 finance). STAFF 차단. layout과 이중화.
  const session = await auth();
  if (!session || !canViewFinance(session.user?.role)) redirect("/login");

  const params = await searchParams;
  // 빠른 필터(?range=)가 있으면 해당 월로 변환해 yearMonth로 사용 (range 우선).
  // 정산은 월 단위 집계이므로 from의 "YYYY-MM"만 취한다. 없으면 기존 yearMonth 로직 유지.
  const quickRange = resolveQuickRange(params.range);
  const yearMonth = quickRange
    ? quickRange.from.slice(0, 7)
    : params.yearMonth && YEAR_MONTH_RE.test(params.yearMonth)
      ? params.yearMonth
      : todayVnDateString().slice(0, 7);

  const { start, end } = monthRangeUtc(yearMonth);

  const [settlements, revenue, settledBookings] = await Promise.all([
    prisma.settlement.findMany({
      where: { yearMonth },
      orderBy: { supplier: { name: "asc" } },
      select: {
        id: true,
        supplierId: true,
        totalVnd: true,
        status: true,
        paidAt: true,
        supplier: { select: { name: true, phone: true } },
        items: {
          orderBy: { booking: { checkOut: "asc" } },
          select: {
            id: true,
            amountVnd: true,
            // booking 요약 — 빌라명·기간·박수만 (고객 연락처 미포함, leak-checklist)
            booking: {
              select: {
                checkOut: true,
                nights: true,
                villa: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    // 매출 요약 — 정산과 동일 기준(체크아웃 월 + CHECKED_OUT·NO_SHOW)을 saleCurrency별 합산.
    // KRW 예약은 totalSaleVnd가 null이므로 단일 aggregate로 통화별 분리 집계가 보장된다.
    prisma.booking.aggregate({
      where: {
        status: { in: [...SETTLEMENT_BOOKING_STATUSES] },
        checkOut: { gte: start, lt: end },
      },
      _sum: { totalSaleKrw: true, totalSaleVnd: true },
    }),
    // 운영자 손익(수납·환산·환차·마진) 파생용 — 정산 대상 예약의 금액·통화·환율 스냅샷 + 공급자.
    // ★ ADMIN(canViewFinance) 전용 — 마진·VND환산은 server에서만 계산, 공급자 미노출.
    prisma.booking.findMany({
      where: {
        status: { in: [...SETTLEMENT_BOOKING_STATUSES] },
        checkOut: { gte: start, lt: end },
      },
      select: {
        saleCurrency: true,
        totalSaleKrw: true,
        totalSaleVnd: true,
        supplierCostVnd: true,
        fxVndPerKrw: true,
        villa: { select: { supplierId: true } },
        // 정산 2차 P2-1 — 실수납 합산용 (Payment.vndEquivalent). ADMIN 전용.
        payments: { select: { vndEquivalent: true } },
      },
    }),
  ]);

  // 총 지급액 — BigInt 합산 (Number 변환 금지)
  const totalPayoutVnd = settlements.reduce((sum, s) => sum + s.totalVnd, 0n);

  // ── 운영자 손익 파생 (정산 고도화 1차) — 스키마 무변경, 기존 필드에서 계산 ──
  // Decimal(14,4) fxVndPerKrw → 문자열(krwToVndSnapshot 입력). KRW 예약 VND 환산 스냅샷.
  const toFinanceBooking = (b: {
    saleCurrency: (typeof settledBookings)[number]["saleCurrency"];
    totalSaleKrw: number | null;
    totalSaleVnd: bigint | null;
    supplierCostVnd: bigint;
    fxVndPerKrw: { toString(): string } | null;
  }): FinanceBooking => ({
    saleCurrency: b.saleCurrency,
    totalSaleKrw: b.totalSaleKrw,
    totalSaleVnd: b.totalSaleVnd,
    supplierCostVnd: b.supplierCostVnd,
    fxVndPerKrw: b.fxVndPerKrw != null ? b.fxVndPerKrw.toString() : null,
  });
  const financeBookings = settledBookings.map(toFinanceBooking);
  const finance = summarizeFinance(financeBookings);

  // 실수납 합계 (정산 2차 P2-1) — 예약별 Payment.vndEquivalent 합. 견적 환산(collectedVndEquivalent) 대비 미수.
  // 1차 마진은 견적 기준 유지(마진 기준 실수납 전환은 P2-2 회계 결정). 여기선 실수납·미수만 병기.
  const actualCollectedVnd = settledBookings.reduce(
    (sum, b) => sum + b.payments.reduce((s, p) => s + (p.vndEquivalent ?? 0n), 0n),
    0n
  );
  const outstandingVnd = finance.collectedVndEquivalent - actualCollectedVnd;

  // 공급자별 마진(ADMIN 전용) — supplierId별 그룹 → 합계. 정산 행에 매칭.
  const bySupplier = new Map<string, FinanceBooking[]>();
  for (const b of settledBookings) {
    const list = bySupplier.get(b.villa.supplierId) ?? [];
    list.push(toFinanceBooking(b));
    bySupplier.set(b.villa.supplierId, list);
  }
  const marginBySupplier = new Map<string, bigint>();
  for (const [supplierId, list] of bySupplier) {
    marginBySupplier.set(supplierId, summarizeFinance(list).marginVnd);
  }

  // 음수(역마진) 포함 VND 표기
  const fmtSignedVnd = (v: bigint) =>
    v < 0n ? `-${formatVnd((-v).toString())}` : formatVnd(v.toString());

  // 클라이언트 경계 직렬화 — BigInt는 문자열, 날짜는 표시 문자열로 변환
  const rows: SettlementRow[] = settlements.map((s) => ({
    id: s.id,
    supplierName: s.supplier.name,
    supplierPhone: s.supplier.phone,
    totalVndText: formatVnd(s.totalVnd.toString()),
    // 운영자 마진(ADMIN 전용) — 이 공급자 예약들의 (수납 VND환산 − 지급) 합. 데이터 없으면 null.
    marginVndText: marginBySupplier.has(s.supplierId)
      ? fmtSignedVnd(marginBySupplier.get(s.supplierId)!)
      : null,
    status: s.status,
    // b7: "2026.07.31 완료" — 날짜만 (Asia/Ho_Chi_Minh 표시 규칙)
    paidAtText: s.paidAt ? formatDateTime(s.paidAt).split(" ")[0] : null,
    items: s.items.map((it) => ({
      id: it.id,
      villaName: it.booking.villa.name,
      checkOutText: toDateOnlyString(it.booking.checkOut).replaceAll("-", "."),
      nights: it.booking.nights,
      amountVndText: formatVnd(it.amountVnd.toString()),
    })),
  }));

  const summary = {
    // b7 표기: KRW는 "12,450,000원", VND는 "86,200,000₫" (ADMIN 쉼표 규칙)
    krwRevenueText: `${formatThousands(revenue._sum.totalSaleKrw ?? 0)}원`,
    vndRevenueText: formatVnd((revenue._sum.totalSaleVnd ?? 0n).toString()),
    supplierCount: settlements.length,
    totalPayoutText: formatVnd(totalPayoutVnd.toString()),
  };

  // 운영자 손익 요약(ADMIN 전용, 정산 고도화 1차) — 수납·VND환산·지급·마진·환율미상.
  const financeSummary = {
    collectedKrwText: `${formatThousands(finance.collectedKrw)}원`,
    collectedVndText: formatVnd(finance.collectedVnd.toString()),
    collectedVndEquivalentText: formatVnd(finance.collectedVndEquivalent.toString()),
    // 정산 2차 P2-1 — 실수납 합계·미수(견적 환산 − 실수납). 미수 양수=받을 돈, 음수=초과수납.
    actualCollectedText: formatVnd(actualCollectedVnd.toString()),
    outstandingText: fmtSignedVnd(outstandingVnd),
    outstandingPositive: outstandingVnd > 0n,
    payoutText: formatVnd(finance.payoutVnd.toString()),
    marginVndText: fmtSignedVnd(finance.marginVnd),
    marginPositive: finance.marginVnd >= 0n,
    fxMissingCount: finance.fxMissingCount,
    bookingCount: finance.bookingCount,
  };

  return (
    <SettlementsView
      yearMonth={yearMonth}
      summary={summary}
      financeSummary={financeSummary}
      rows={rows}
    />
  );
}
