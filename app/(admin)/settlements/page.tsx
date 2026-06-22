// /settlements — 운영자 월 정산 (T4.5, Stitch b7-settlements 변환, SPEC F6)
// RSC: prisma 직접 조회 (목록·상세 items·매출 요약). 집계·전이 액션만 BE API 소비.
// 매출 요약은 통화별 분리(KRW/VND 합산 금지 — ADR-0003), 공급자 지급은 VND 단일.
// 금액: BigInt → 문자열 → lib/format (Number() 캐스팅 금지 — money-pattern)
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatThousands, formatVnd, formatDateTime } from "@/lib/format";
import { toDateOnlyString, todayVnDateString, resolveQuickRange } from "@/lib/date-vn";
import { monthRangeUtc, SETTLEMENT_BOOKING_STATUSES } from "@/lib/settlement";
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
  // ADMIN 가드는 (admin)/layout에 있으나 페이지에서도 재검사 (프로젝트 규칙 — 권한 이중화)
  const session = await auth();
  if (!session || session.user?.role !== "ADMIN") redirect("/login");

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

  const [settlements, revenue] = await Promise.all([
    prisma.settlement.findMany({
      where: { yearMonth },
      orderBy: { supplier: { name: "asc" } },
      select: {
        id: true,
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
  ]);

  // 총 지급액 — BigInt 합산 (Number 변환 금지)
  const totalPayoutVnd = settlements.reduce((sum, s) => sum + s.totalVnd, 0n);

  // 클라이언트 경계 직렬화 — BigInt는 문자열, 날짜는 표시 문자열로 변환
  const rows: SettlementRow[] = settlements.map((s) => ({
    id: s.id,
    supplierName: s.supplier.name,
    supplierPhone: s.supplier.phone,
    totalVndText: formatVnd(s.totalVnd.toString()),
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

  return <SettlementsView yearMonth={yearMonth} summary={summary} rows={rows} />;
}
