// D 원가 관리 + 빌라별 시즌 (a15-cost-seasons) — 시즌 원가 수정/삭제 + 시즌 날짜 범위 CRUD.
// 소유 검증 후 rates(supplierCostVnd만)·seasonPeriods 로드 → 클라 에디터.
// 누수 0: VillaRate는 supplierCostVnd만 select. salePrice*/margin* 미조회 (구조적 보장).
import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { toDateOnlyString } from "@/lib/date-vn";
import CostSeasonsEditor, { type InitialSeasonPeriod } from "./cost-seasons-editor";

export const metadata: Metadata = {
  title: "Giá gốc & mùa",
};

export default async function CostPage({
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
      // 누수 차단 — supplierCostVnd만. sale/margin 필드는 select에 부재
      rates: { select: { season: true, supplierCostVnd: true } },
      seasonPeriods: {
        orderBy: { startDate: "asc" },
        select: { id: true, season: true, startDate: true, endDate: true, label: true },
      },
    },
  });
  if (!villa || villa.supplierId !== session.user.id) notFound();

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "costSeasons" });

  // 시즌별 원가 (VND 문자열). 미입력 시즌은 "" (빈 시즌 게이트)
  const costs: Record<string, string> = { LOW: "", HIGH: "", PEAK: "" };
  for (const r of villa.rates) costs[r.season] = r.supplierCostVnd.toString();

  const periods: InitialSeasonPeriod[] = villa.seasonPeriods.map((p) => ({
    id: p.id,
    season: p.season,
    startDate: toDateOnlyString(p.startDate),
    endDate: toDateOnlyString(p.endDate),
    label: p.label,
  }));

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

      <CostSeasonsEditor
        villaId={villa.id}
        initialCosts={costs}
        initialPeriods={periods}
      />
    </div>
  );
}
