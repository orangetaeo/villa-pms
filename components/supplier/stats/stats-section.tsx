// 공급자 통계 섹션 (서버 컴포넌트) — T-supplier-statistics
// 매출(=supplierCostVnd)·가동율만. 차트 라벨은 서버에서 번역해 client 차트에 props로 전달
// (client useTranslations 미사용 → SUPPLIER_CLIENT_NAMESPACES 변경 불필요, adminStatistics 누수 0).
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { todayVnDateString } from "@/lib/date-vn";
import { resolveStatsPeriod } from "@/lib/statistics";
import { loadSupplierStats } from "@/lib/supplier-stats";
import PaginationBar from "@/components/pagination-bar";
// 차트는 recharts 의존 → lazy 래퍼로 코드 스플리팅(perf). [[charts-lazy]]
import { RevenueBar, OccupancyArea } from "@/components/supplier/stats/charts-lazy";

const PERIOD_CHIPS = ["thisMonth", "lastMonth", "year"] as const;
type PeriodChip = (typeof PERIOD_CHIPS)[number];

function activeChip(range: string | undefined): PeriodChip {
  return range === "thisMonth" || range === "lastMonth" ? range : "year";
}

/** 공급자 기간 해석 — year(기본)는 1월1일~오늘 custom, 그 외는 프리셋 */
function resolveSupplierPeriod(range: string | undefined, now: Date) {
  if (range === "thisMonth" || range === "lastMonth") {
    return resolveStatsPeriod({ range }, now);
  }
  const today = todayVnDateString(now); // 'YYYY-MM-DD' (Asia/Ho_Chi_Minh)
  const year = today.slice(0, 4);
  return resolveStatsPeriod({ from: `${year}-01-01`, to: today }, now);
}

/** 증감 배지(▲/▼). null이면 미표시. occupancy는 %p, revenue는 % */
function ChangeBadge({ pct, suffix, label }: { pct: number | null; suffix: string; label: string }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px]">
      <span className={`flex items-center font-bold ${up ? "text-emerald-600" : "text-rose-500"}`}>
        <span className="material-symbols-outlined text-sm">
          {up ? "arrow_drop_up" : "arrow_drop_down"}
        </span>
        {Math.abs(pct)}
        {suffix}
      </span>
      <span className="text-slate-400">{label}</span>
    </div>
  );
}

export default async function StatsSection({
  supplierId,
  locale,
  range,
  page = 1,
  pageSize = 10,
}: {
  supplierId: string;
  locale: string;
  range?: string;
  /** 빌라별 성과 리스트 페이지네이션 (공용 page/pageSize 쿼리) */
  page?: number;
  pageSize?: number;
}) {
  const t = await getTranslations({ locale, namespace: "supplierStats" });
  const now = new Date();
  const period = resolveSupplierPeriod(range, now);
  const stats = await loadSupplierStats(supplierId, period);
  const chip = activeChip(range);

  const hasData = stats.villaCount > 0;

  // 빌라별 성과 — 메모리 슬라이스 페이지네이션(공급자 빌라 수는 적어 충분)
  const villaTotal = stats.villas.length;
  const pagedVillas = stats.villas.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  return (
    <div className="space-y-6">
      {/* 기간 칩 — 코치마크 앵커(earnings-period). 이 컴포넌트는 현재 earnings 전용
          (벤더 통계는 자체 인라인 UI·vstats- 앵커) — 다른 화면에서 재사용하게 되면 앵커를 prop 주입으로 전환 */}
      <div data-tour="earnings-period" className="flex gap-2">
        {PERIOD_CHIPS.map((key) => {
          const active = key === chip;
          return (
            <Link
              key={key}
              href={`/earnings?view=stats&range=${key}`}
              aria-current={active ? "true" : undefined}
              className={
                active
                  ? "rounded-full bg-teal-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-transform active:scale-95"
                  : "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-transform active:scale-95"
              }
            >
              {t(`period_${key}`)}
            </Link>
          );
        })}
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white p-10 text-center shadow-sm">
          <span className="material-symbols-outlined text-5xl text-teal-600">bar_chart</span>
          <p className="text-sm font-bold text-slate-700">{t("empty")}</p>
          <p className="text-sm text-slate-500">{t("emptyHint")}</p>
        </div>
      ) : (
        <>
          {/* KPI 2x2 — 코치마크 앵커(earnings-kpi). hasData 조건부 — 빈 데이터면 스텝 자동 스킵 */}
          <div data-tour="earnings-kpi" className="grid grid-cols-2 gap-3">
            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("kpiRevenue")}
              </p>
              {/* 연 누적은 수십억 VND(14자리+) — 반쪽 카드 폭 초과 시 ₫ 잘림 방지: 폰트 축소 + 줄바꿈 허용 */}
              <p className="mt-1 break-words text-xl font-extrabold leading-tight tracking-tight text-teal-700 tabular-nums">
                {stats.totalVndText}
              </p>
              <ChangeBadge pct={stats.revenueChangePct} suffix="%" label={t("vsPrev")} />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("kpiOccupancy")}
              </p>
              <p className="mt-1 break-words text-xl font-extrabold leading-tight tracking-tight text-slate-900 tabular-nums">
                {stats.currentRatePct}
                <span className="text-base font-bold text-slate-400">%</span>
              </p>
              <ChangeBadge pct={stats.occupancyChangePct} suffix="%p" label={t("vsPrev")} />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("kpiBookings")}
              </p>
              <p className="mt-1 break-words text-xl font-extrabold leading-tight tracking-tight text-slate-900 tabular-nums">
                {stats.bookingCount}
                <span className="ml-1 text-base font-bold text-slate-400">{t("unitCount")}</span>
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                {t("kpiAvgNights")}
              </p>
              <p className="mt-1 break-words text-xl font-extrabold leading-tight tracking-tight text-slate-900 tabular-nums">
                {stats.avgNights}
                <span className="ml-1 text-base font-bold text-slate-400">{t("unitNights")}</span>
              </p>
            </div>
          </div>

          {/* 수익 추이 */}
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-base font-bold text-slate-800">{t("revenueTrendTitle")}</h3>
            <RevenueBar data={stats.revenueTrend} legend={t("revenueLegend")} />
          </section>

          {/* 가동율 추이 */}
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-base font-bold text-slate-800">{t("occupancyTrendTitle")}</h3>
            <OccupancyArea data={stats.occupancyTrend} legend={t("occupancyLegend")} />
          </section>

          {/* 빌라별 성과 */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-slate-800">{t("villaPerfTitle")}</h3>
            {pagedVillas.map((v) => (
              <div
                key={v.villaId}
                className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate font-bold text-slate-900">{v.name}</h4>
                    {v.complex && (
                      <p className="truncate text-xs text-slate-400">{v.complex}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-lg font-bold text-teal-700 tabular-nums">
                    {v.vndText}
                  </p>
                </div>
                {/* 가동율 바 */}
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{ width: `${Math.min(v.ratePct, 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-bold text-slate-600 tabular-nums">
                    {v.ratePct}%
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {t("villaNights", { count: v.occupiedNights })}
                </p>
              </div>
            ))}
            {/* 페이지네이션 (라이트) — 빌라가 많을 때만 네비 표시, 합계 요약은 항상 */}
            <PaginationBar total={villaTotal} page={page} pageSize={pageSize} light />
          </section>
        </>
      )}
    </div>
  );
}
