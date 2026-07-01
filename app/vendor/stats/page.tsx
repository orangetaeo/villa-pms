// /vendor/stats — 원천 공급자 발주 통계 (ADR-0023 S4 §6.4). vi 기본·모바일·라이트.
//   layout이 Role=VENDOR 보장. 서버 컴포넌트 — 차트 라벨은 서버에서 번역해 client 차트에 props로 전달
//   (client useTranslations 미사용 → VENDOR_CLIENT_NAMESPACES 변경 불필요, adminXxx 누수 0).
//   ★ 누수: costVnd(=우리 지급액=공급자 매출)만. 우리 판매가·마진·타 공급자 발주 절대 비노출.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import { todayVnDateString } from "@/lib/date-vn";
import { resolveStatsPeriod } from "@/lib/statistics";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { loadVendorStats } from "@/lib/vendor-stats";
// 차트는 recharts 의존 → lazy 래퍼로 코드 스플리팅(perf).
import { RevenueBar } from "@/components/supplier/stats/charts-lazy";

export const metadata: Metadata = {
  title: "Thống kê — Villa Go",
};

const PERIOD_CHIPS = ["thisMonth", "lastMonth", "year"] as const;
type PeriodChip = (typeof PERIOD_CHIPS)[number];

function activeChip(range: string | undefined): PeriodChip {
  return range === "thisMonth" || range === "lastMonth" ? range : "year";
}

/** 기간 해석 — year(기본)는 1월1일~오늘 custom, 그 외는 프리셋 (supplier-stats 화면 패턴 동형) */
function resolveVendorPeriod(range: string | undefined, now: Date) {
  if (range === "thisMonth" || range === "lastMonth") {
    return resolveStatsPeriod({ range }, now);
  }
  const today = todayVnDateString(now); // 'YYYY-MM-DD' (Asia/Ho_Chi_Minh)
  const year = today.slice(0, 4);
  return resolveStatsPeriod({ from: `${year}-01-01`, to: today }, now);
}

/** 증감 배지(▲/▼). null이면 미표시. */
function ChangeBadge({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px]">
      <span className={`flex items-center font-bold ${up ? "text-emerald-600" : "text-rose-500"}`}>
        <span className="material-symbols-outlined text-sm">
          {up ? "arrow_drop_up" : "arrow_drop_down"}
        </span>
        {Math.abs(pct)}%
      </span>
      <span className="text-slate-400">{label}</span>
    </div>
  );
}

export default async function VendorStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "VENDOR") redirect("/login");

  const vendorId = await getVendorIdForUser(session.user.id);
  if (!vendorId) redirect("/vendor");

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "vendor" });

  const { range } = await searchParams;
  const now = new Date();
  const period = resolveVendorPeriod(range, now);
  const stats = await loadVendorStats(vendorId, period, locale);
  const chip = activeChip(range);

  const hasData = stats.orderCount > 0 || stats.acceptanceRatePct !== null;

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 pb-28 pt-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold text-neutral-900">{t("stats.title")}</h1>
          <p className="text-sm text-neutral-500">{t("stats.subtitle")}</p>
        </div>
        <Link
          href="/vendor"
          className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 active:scale-95"
        >
          {t("stats.backToOrders")}
        </Link>
      </header>

      {/* 기간 칩 */}
      <div className="flex gap-2">
        {PERIOD_CHIPS.map((key) => {
          const active = key === chip;
          return (
            <Link
              key={key}
              href={`/vendor/stats?range=${key}`}
              aria-current={active ? "true" : undefined}
              className={
                active
                  ? "rounded-full bg-teal-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-transform active:scale-95"
                  : "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-transform active:scale-95"
              }
            >
              {t(`stats.period_${key}`)}
            </Link>
          );
        })}
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white p-10 text-center shadow-sm">
          <span className="material-symbols-outlined text-5xl text-teal-600">bar_chart</span>
          <p className="text-sm font-bold text-slate-700">{t("stats.empty")}</p>
          <p className="text-sm text-slate-500">{t("stats.emptyHint")}</p>
        </div>
      ) : (
        <>
          {/* KPI 2x2 — costVnd 기반(매출·발주수·수락율·평균단가). 판매가·마진 없음. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("stats.kpiRevenue")}
              </p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight text-teal-700 tabular-nums">
                {stats.totalVndText}
              </p>
              <ChangeBadge pct={stats.revenueChangePct} label={t("stats.vsPrev")} />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("stats.kpiOrders")}
              </p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                {stats.orderCount}
                <span className="ml-1 text-base font-bold text-slate-400">{t("stats.unitCount")}</span>
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("stats.kpiAcceptance")}
              </p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                {stats.acceptanceRatePct === null ? "—" : stats.acceptanceRatePct}
                {stats.acceptanceRatePct !== null && (
                  <span className="text-base font-bold text-slate-400">%</span>
                )}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("stats.kpiAvgUnit")}
              </p>
              <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                {stats.avgUnitVndText}
              </p>
            </div>
          </div>

          {/* 매출 추이(막대) — 공급자 RevenueBar 재사용(VND only, 라벨 서버 번역) */}
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-base font-bold text-slate-800">{t("stats.revenueTrendTitle")}</h3>
            <RevenueBar data={stats.revenueTrend} legend={t("stats.revenueLegend")} />
          </section>

          {/* 정산 상태 — 미정산 vs 정산완료(VND만) */}
          <section className="relative overflow-hidden rounded-2xl bg-teal-600 p-6 text-white shadow-xl">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-teal-500 opacity-20" />
            <div className="relative z-10 space-y-4">
              <div>
                <p className="text-sm font-medium text-teal-50 opacity-90">{t("stats.unsettledLabel")}</p>
                <h2 className="mt-1 text-4xl font-extrabold tracking-tight">{stats.unsettledVndText}</h2>
              </div>
              <div className="h-px w-full bg-white/20" />
              <div className="flex items-center gap-1.5 text-xs font-medium text-teal-50">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>
                  {t("stats.settledLabel")}: {stats.settledVndText}
                </span>
              </div>
            </div>
          </section>

          {/* 인기 품목 Top — 발주 건수·수량·매출 */}
          {stats.topItems.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-base font-bold text-slate-800">{t("stats.topItemsTitle")}</h3>
              {stats.topItems.map((item) => (
                <div
                  key={item.itemLabel}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm"
                >
                  <div className="min-w-0">
                    <h4 className="truncate font-bold text-slate-900">{item.itemLabel}</h4>
                    <p className="text-xs text-slate-400">
                      {t("stats.itemMeta", { orders: item.orderCount, qty: item.quantity })}
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-bold text-teal-700 tabular-nums">{item.vndText}</p>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
