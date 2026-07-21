// 공급자 기간별 원가 (ADR-0014 후속) — 기본요금 + 웃돈 기간 N의 원가만 입력.
// 누수 0: VillaRatePeriod는 supplierCostVnd·날짜만 select. salePrice*/margin* 미조회(구조적 보장).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/date-vn";
import SupplierRateCalendar from "./supplier-rate-calendar";
import type { SupplierLayerDTO } from "./supplier-calendar-lib";

export const metadata: Metadata = {
  title: "Giá gốc theo giai đoạn",
};

export default async function SupplierRatePeriodsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/");

  const { id } = await params;
  const villa = await prisma.villa.findUnique({
    where: { id },
    select: {
      id: true,
      supplierId: true,
      premiumDays: true, // ADR-0042 프리미엄 요일 — 가격 아님(비밀 아님). 공급자 요일 칩에 노출.
      // 누수 차단 — 원가·날짜만. sale/margin 필드는 select에 부재
      ratePeriods: {
        orderBy: [{ isBase: "desc" }, { startDate: "asc" }],
        // 누수 차단 — 공급자 소유 금액만(supplierCostVnd 원가 + supplierSalePriceVnd 공급자 자기 판매가
        //   + ADR-0042 premiumSupplierCostVnd·premiumSupplierSalePriceVnd 자기 프리미엄만).
        // salePriceVnd/salePriceKrw/premiumSalePrice*/premiumConsumer*/marginType/marginValue(운영자 재판매·마진)는 절대 select 금지.
        select: {
          id: true, isBase: true, season: true, startDate: true, endDate: true,
          supplierCostVnd: true, supplierSalePriceVnd: true,
          premiumSupplierCostVnd: true, premiumSupplierSalePriceVnd: true,
          label: true,
        },
      },
    },
  });
  if (!villa || villa.supplierId !== session.user.id) notFound();

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "supplierRatePeriods" });

  // 전역 공휴일 — ★ 표시 + 프리미엄 판정용(가격 아님·비밀 아님).
  const holidayRows = await prisma.holidayDate.findMany({
    orderBy: { date: "asc" },
    select: { date: true, label: true },
  });
  const holidays = holidayRows.map((h) => ({ date: toDateOnlyString(h.date), label: h.label }));

  // ★ 마진 비공개: 공급자 소유 금액(원가·프리미엄 원가·자기 판매가)만 DTO로 직렬화. Net/소비자가/마진 부재.
  const toLayerDTO = (r: (typeof villa.ratePeriods)[number], isBase: boolean): SupplierLayerDTO => ({
    id: r.id,
    isBase,
    season: r.season,
    startDate: isBase ? null : r.startDate ? toDateOnlyString(r.startDate) : null,
    endDate: isBase ? null : r.endDate ? toDateOnlyString(r.endDate) : null,
    label: r.label ?? null,
    supplierCostVnd: r.supplierCostVnd.toString(),
    ownSaleVnd: r.supplierSalePriceVnd?.toString() ?? null,
    premiumCostVnd: r.premiumSupplierCostVnd?.toString() ?? null,
    premiumOwnSaleVnd: r.premiumSupplierSalePriceVnd?.toString() ?? null,
  });

  const baseRow = villa.ratePeriods.find((r) => r.isBase);
  const base: SupplierLayerDTO = baseRow
    ? toLayerDTO(baseRow, true)
    : {
        id: "", isBase: true, season: "LOW", startDate: null, endDate: null, label: null,
        supplierCostVnd: "", ownSaleVnd: null, premiumCostVnd: null, premiumOwnSaleVnd: null,
      };

  const periods: SupplierLayerDTO[] = villa.ratePeriods
    .filter((r) => !r.isBase)
    .map((r) => toLayerDTO(r, false));

  return (
    <div className="mx-auto w-full max-w-[420px]">
      <header className="sticky top-0 z-40 flex h-14 w-full items-center bg-white px-2 shadow-sm">
        <Link
          href={`/my-villas/${villa.id}`}
          aria-label={t("back")}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:bg-neutral-50 active:scale-95"
        >
          <span className="material-symbols-outlined text-teal-600">arrow_back</span>
        </Link>
        <h1 className="flex-1 truncate px-1 text-center text-lg font-semibold text-slate-800">
          {t("title")}
        </h1>
        <div className="h-10 w-10" />
      </header>

      <SupplierRateCalendar
        villaId={villa.id}
        initialBase={base}
        initialPeriods={periods}
        initialPremiumDays={villa.premiumDays}
        holidays={holidays}
      />
    </div>
  );
}
