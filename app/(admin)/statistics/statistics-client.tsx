"use client";

// 통계 클라이언트 — 탭 전환 + 기간 필터 + URL(?tab=&range=) 동기화 (T-admin-statistics §5)
// ★ 개요 탭은 fin=false면 탭 버튼·콘텐츠 모두 미존재(props.overview가 없음).
//   금액 게이트는 서버(page.tsx)에서 끝났고, 여기선 "받은 것만" 렌더한다(누수 가드 보조).

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type {
  OverviewStats,
  OccupancyStats,
  VillaPerformanceRow,
  FunnelStats,
  OperationsStats,
  MinibarStats,
  ServiceOrderStats,
} from "@/lib/statistics";

/** 직렬화 가능한 기간 메타(page.tsx가 period에서 추려 내려보냄) */
export interface StatsPeriodMeta {
  fromText: string;
  toText: string;
  granularity: "day" | "month";
  presetKey: string | null;
}
import { formatThousands } from "@/lib/format";
import KpiCard from "@/components/admin/statistics/kpi-card";
import RevenueChart from "@/components/admin/statistics/revenue-chart";
import ChannelDonut from "@/components/admin/statistics/channel-donut";
import OccupancyLine from "@/components/admin/statistics/occupancy-line";
import VillaRankTable from "@/components/admin/statistics/villa-rank-table";
import Funnel from "@/components/admin/statistics/funnel";
import DateRangeFilter from "@/components/admin/statistics/date-range-filter";
import MinibarChart from "@/components/admin/statistics/minibar-chart";
import ServiceChart from "@/components/admin/statistics/service-chart";

export type TabKey = "overview" | "occupancy" | "villas" | "operations" | "ancillary";

export interface StatisticsProps {
  fin: boolean;
  activeTab: TabKey;
  /** 해석된 기간 메타(프리셋·커스텀 표시·granularity) */
  period: StatsPeriodMeta;
  /** fin=true일 때만 존재 — 없으면 개요 탭 자체 미노출 */
  overview?: OverviewStats;
  /** fin=true일 때만 존재 — 미니바 매출·마진(재무) */
  minibar?: MinibarStats;
  /** fin=true일 때만 존재 — 부가서비스 매출·마진(재무, ADR-0019 후속) */
  services?: ServiceOrderStats;
  occupancy: OccupancyStats;
  villas: VillaPerformanceRow[];
  funnel: FunnelStats;
  operations: OperationsStats;
}

// ancillary(부가서비스·미니바)는 operations 바로 다음(운영지표 옆)에 배치.
const ALL_TABS: TabKey[] = ["overview", "occupancy", "villas", "operations", "ancillary"];
const TAB_ICONS: Record<TabKey, string> = {
  overview: "payments",
  occupancy: "event_available",
  villas: "leaderboard",
  operations: "conversion_path",
  ancillary: "room_service",
};

export default function StatisticsClient(props: StatisticsProps) {
  const t = useTranslations("adminStatistics");
  const router = useRouter();
  const searchParams = useSearchParams();

  // 개요·부가서비스/미니바 탭은 매출=재무 전용 → fin=false(STAFF)면 둘 다 미노출(누수 유지).
  const tabs = useMemo(
    () =>
      props.fin
        ? ALL_TABS
        : ALL_TABS.filter((x) => x !== "overview" && x !== "ancillary"),
    [props.fin]
  );

  const [tab, setTab] = useState<TabKey>(
    tabs.includes(props.activeTab) ? props.activeTab : tabs[0]
  );

  // 탭 전환만 client 상태 — 기간 필터(프리셋/커스텀)는 DateRangeFilter가 URL 동기화 담당
  const onTab = useCallback(
    (next: TabKey) => {
      setTab(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-lg font-bold text-white">{t("title")}</h1>
        <span className="text-slate-600">/</span>
        <span className="text-sm text-admin-muted">{t("subtitle")}</span>
      </div>

      {/* 탭 바 + 기간 필터 */}
      <div className="flex items-end justify-between border-b border-slate-800 mt-4 gap-3 flex-wrap">
        {/* 데스크톱 탭 / 모바일 가로 스크롤 칩 */}
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mb-px">
          {tabs.map((k) => {
            const active = k === tab;
            return (
              <button
                key={k}
                type="button"
                onClick={() => onTab(k)}
                className={
                  active
                    ? "px-4 py-3 text-sm font-bold text-white border-b-2 border-admin-primary flex items-center gap-2 whitespace-nowrap"
                    : "px-4 py-3 text-sm font-medium text-slate-400 hover:text-white border-b-2 border-transparent flex items-center gap-2 whitespace-nowrap"
                }
              >
                <span className="material-symbols-outlined text-base">{TAB_ICONS[k]}</span>
                {t(`tabs.${k}`)}
              </button>
            );
          })}
        </div>

        {/* 기간 필터 — 프리셋 칩 + 커스텀 달력(from/to). URL(?range= 또는 ?from=&to=) 동기화. */}
        <div className="mb-2">
          <DateRangeFilter
            presetKey={props.period.presetKey}
            fromText={props.period.fromText}
            toText={props.period.toText}
          />
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="py-6 space-y-6">
        {tab === "overview" && props.overview && <OverviewTab data={props.overview} />}
        {tab === "occupancy" && <OccupancyTab data={props.occupancy} />}
        {tab === "villas" && (
          <VillasTab rows={props.villas} hasFinance={props.fin} />
        )}
        {tab === "operations" && (
          <OperationsTab data={props.operations} funnel={props.funnel} fin={props.fin} />
        )}
        {tab === "ancillary" && (props.minibar || props.services) && (
          <AncillaryTab minibar={props.minibar} services={props.services} />
        )}
      </div>
    </div>
  );
}

// ── 탭1. 개요 ────────────────────────────────────────────────
// KPI·매출추이는 빌라+부가서비스+미니바 합산 총계(BE가 loadOverviewStats에서 통합).
// 통화 분리(KRW·VND)는 그대로 유지. 미니바·부가서비스 상세는 ancillary 탭으로 분리됨.
function OverviewTab({ data }: { data: OverviewStats }) {
  const t = useTranslations("adminStatistics");
  const k = data.current;
  const fxMissing = data.trend.reduce((s, m) => s + m.fxMissingCount, 0);

  return (
    <>
      <div className="flex flex-col gap-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-slate-600">info</span>
          {t("overview.basisNote")}
        </span>
        {fxMissing > 0 && (
          <span className="pl-6">{t("overview.fxMissingNote", { count: fxMissing })}</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label={t("overview.kpi.krwRevenue")}
          value={formatThousands(k.krwRevenue)}
          unit="원"
          changePct={k.krwChangePct}
          changeFromLabel={t("common.changeFromPrev")}
          accent="krw"
          icon="trending_up"
          iconClassName="text-admin-krw"
          footer={<p className="text-[10px] text-slate-500">{t("overview.kpi.krwRevenueNote")}</p>}
        />
        <KpiCard
          label={t("overview.kpi.vndRevenue")}
          value={formatThousands(k.vndRevenue)}
          unit="₫"
          changePct={k.vndChangePct}
          changeFromLabel={t("common.changeFromPrev")}
          accent="vnd"
          icon="trending_up"
          iconClassName="text-admin-vnd"
          footer={<p className="text-[10px] text-slate-500">{t("overview.kpi.vndRevenueNote")}</p>}
        />
        <KpiCard
          label={t("overview.kpi.margin")}
          value={formatThousands(k.marginVnd)}
          unit="₫"
          changePct={k.marginChangePct}
          changeFromLabel={t("common.changeFromPrev")}
          icon="savings"
          iconClassName="text-amber-400"
          footer={
            <p className="inline-flex items-center gap-1 text-[10px] text-amber-400/80 bg-amber-500/10 px-1.5 py-0.5 rounded">
              <span className="material-symbols-outlined text-[11px]">currency_exchange</span>
              {t("common.fxSnapshotNote")}
            </p>
          }
        />
        <KpiCard
          label={t("overview.kpi.marginRate")}
          value={k.marginRatePct ?? "-"}
          unit={k.marginRatePct != null ? "%" : undefined}
          icon="percent"
          iconClassName="text-indigo-400"
          footer={<p className="text-[10px] text-slate-500">{t("overview.kpi.marginRateNote")}</p>}
        />
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-8 bg-admin-card rounded-xl border border-slate-700/50 p-5">
          <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-white">{t("overview.revenueChart.title")}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {t("overview.revenueChart.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 h-3 rounded-sm bg-admin-krw" />
                {t("overview.revenueChart.krwLegend")}
              </div>
              <div className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 h-3 rounded-sm bg-admin-vnd" />
                {t("overview.revenueChart.vndLegend")}
              </div>
            </div>
          </div>
          <RevenueChart
            data={data.trend}
            krwLegend={t("overview.revenueChart.krwLegend")}
            vndLegend={t("overview.revenueChart.vndLegend")}
          />
        </div>

        <div className="col-span-12 xl:col-span-4 bg-admin-card rounded-xl border border-slate-700/50 p-5">
          <ChannelDonut
            channels={data.channels}
            labels={{
              title: t("overview.channelChart.title"),
              byCount: t("overview.channelChart.byCount"),
              byRevenue: t("overview.channelChart.byRevenue"),
              totalBookings: t("overview.channelChart.totalBookings"),
              bookingsUnit: t("common.bookingsUnit"),
              channelName: (c) => t(`channels.${c}`),
            }}
          />
        </div>
      </div>

      {/* 통합 합산표 — 빌라+부가서비스+미니바 소스별·합계 (개요 KPI와 별개) */}
      <IntegratedTable data={data.integrated} t={t} />
    </>
  );
}

// ── 통합 합산표 — 빌라(객실) + 부가서비스 + 미니바 소스별 + 합계 ───────────
function IntegratedTable({
  data,
  t,
}: {
  data: OverviewStats["integrated"];
  t: ReturnType<typeof useTranslations<"adminStatistics">>;
}) {
  const rows: Array<{ key: string; label: string; line: typeof data.villa }> = [
    { key: "villa", label: t("overview.integrated.rowVilla"), line: data.villa },
    { key: "services", label: t("overview.integrated.rowServices"), line: data.services },
    { key: "minibar", label: t("overview.integrated.rowMinibar"), line: data.minibar },
  ];
  return (
    <div className="bg-admin-card rounded-xl border border-slate-700/50 p-5">
      <div className="mb-4">
        <h3 className="font-bold text-white">{t("overview.integrated.title")}</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">{t("overview.integrated.subtitle")}</p>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <MetricCardRow
            key={r.key}
            label={r.label}
            metrics={[
              { label: t("overview.integrated.colKrw"), value: r.line.krwRevenueText, className: "text-admin-krw" },
              { label: t("overview.integrated.colVnd"), value: r.line.vndRevenueText, className: "text-admin-vnd" },
              { label: t("overview.integrated.colMargin"), value: r.line.marginVndText, className: "text-amber-300/90" },
            ]}
          />
        ))}
        {/* 합계 — 강조 카드 */}
        <div className="rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-white">{t("overview.integrated.rowTotal")}</span>
            {data.total.marginRatePct != null && (
              <span className="shrink-0 text-[11px] font-medium text-indigo-300">
                {t("overview.integrated.marginRate")} {data.total.marginRatePct}%
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{t("overview.integrated.colKrw")}</p>
              <p className="truncate text-sm font-bold tabular-nums text-admin-krw">{data.total.krwRevenueText}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{t("overview.integrated.colVnd")}</p>
              <p className="truncate text-sm font-bold tabular-nums text-admin-vnd">{data.total.vndRevenueText}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{t("overview.integrated.colMargin")}</p>
              <p className="truncate text-sm font-bold tabular-nums text-amber-300">{data.total.marginVndText}</p>
            </div>
          </div>
        </div>
      </div>
      {data.total.fxMissingCount > 0 && (
        <p className="mt-3 text-[11px] text-slate-500">
          {t("overview.fxMissingNote", { count: data.total.fxMissingCount })}
        </p>
      )}
    </div>
  );
}

// ── 탭5. 부가서비스·미니바 ───────────────────────────────────
// 매출=재무 → page가 canViewFinance일 때만 minibar/services 전달(STAFF면 props 자체 부재 → 탭 미노출).
// 미니바 섹션 + 부가서비스 섹션을 한 범주로 세로 스택.
function AncillaryTab({
  minibar,
  services,
}: {
  minibar?: MinibarStats;
  services?: ServiceOrderStats;
}) {
  const t = useTranslations("adminStatistics");
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-white">{t("ancillary.title")}</h2>
        <p className="text-[11px] text-slate-500">{t("ancillary.subtitle")}</p>
      </div>
      {minibar && <MinibarSection data={minibar} />}
      {services && <ServiceSection data={services} />}
    </div>
  );
}

// ── 개요 탭 하위. 부가서비스 매출 섹션 (canViewFinance 전용, ADR-0019 후속) ───
// 통화 분리(ADR-0003): KRW·VND 매출 카드 2개 별도. 마진은 VND만(원가가 VND뿐) — null이면 원가 미입력.
function ServiceSection({ data }: { data: ServiceOrderStats }) {
  const t = useTranslations("adminStatistics");
  const hasMargin = data.marginVnd != null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 pt-2">
        <span className="material-symbols-outlined text-emerald-400 text-lg">room_service</span>
        <h2 className="text-base font-bold text-white">{t("services.title")}</h2>
        <span className="text-[11px] text-slate-500">{t("services.subtitle")}</span>
      </div>

      {/* KPI: KRW 매출 + VND 매출(통화 분리) + 마진(null이면 원가 미입력 배지) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label={t("services.kpi.revenueKrw")}
          value={data.revenueKrwText}
          accent="krw"
          icon="room_service"
          iconClassName="text-admin-krw"
          footer={<p className="text-[10px] text-slate-500">{t("services.kpi.revenueKrwNote")}</p>}
        />
        <KpiCard
          label={t("services.kpi.revenueVnd")}
          value={data.revenueVndText}
          accent="vnd"
          icon="room_service"
          iconClassName="text-admin-vnd"
          footer={<p className="text-[10px] text-slate-500">{t("services.kpi.revenueVndNote")}</p>}
        />
        <div className="bg-admin-card p-4 rounded-xl border border-slate-700/50">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-medium text-admin-muted uppercase tracking-wider">
              {t("services.kpi.margin")}
            </span>
            <span className="material-symbols-outlined text-amber-400">savings</span>
          </div>
          {hasMargin ? (
            <>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white tabular-nums">
                  {data.marginVndText}
                </span>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">{t("services.kpi.marginVndNote")}</p>
              {data.costMissingCount > 0 && (
                <p className="mt-1 text-[10px] text-slate-500">
                  {t("services.kpi.marginPartialNote", { count: data.costMissingCount })}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-amber-400/90 bg-amber-500/10 px-2 py-1 rounded">
                  <span className="material-symbols-outlined text-[14px]">price_change</span>
                  {t("services.kpi.costMissing")}
                </span>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {t("services.kpi.costMissingNote", { count: data.costMissingCount })}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* 추이 막대 — KRW·VND 2계열 */}
        <div className="col-span-12 xl:col-span-7 bg-admin-card rounded-xl border border-slate-700/50 p-5">
          <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-white">{t("services.trendChart.title")}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">{t("services.trendChart.subtitle")}</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 h-3 rounded-sm bg-admin-krw" />
                {t("services.trendChart.krwLegend")}
              </div>
              <div className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 h-3 rounded-sm bg-admin-vnd" />
                {t("services.trendChart.vndLegend")}
              </div>
            </div>
          </div>
          <ServiceChart
            data={data.trend}
            krwLegend={t("services.trendChart.krwLegend")}
            vndLegend={t("services.trendChart.vndLegend")}
          />
        </div>

        {/* 타입별 top */}
        <div className="col-span-12 xl:col-span-5 bg-admin-card rounded-xl border border-slate-700/50 p-5">
          <h3 className="font-bold text-white mb-4">{t("services.topTypes.title")}</h3>
          {data.topTypes.length === 0 ? (
            <p className="text-sm text-admin-muted text-center py-8">{t("services.topTypes.empty")}</p>
          ) : (
            <div className="space-y-2">
              {data.topTypes.map((row, i) => (
                <MetricCardRow
                  key={`${row.type}-${i}`}
                  label={t(`services.types.${row.type}`)}
                  count={`${row.quantity} ${t("services.topTypes.qty")}`}
                  metrics={[
                    { label: t("services.topTypes.revenueKrw"), value: row.revenueKrwText, className: "text-admin-krw" },
                    { label: t("services.topTypes.revenueVnd"), value: row.revenueVndText, className: "text-admin-vnd font-medium" },
                  ]}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 품목별(어떤 티켓·메뉴) · 거래처별(어떤 업체) 이용 — 2단 */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-6 bg-admin-card rounded-xl border border-slate-700/50 p-5">
          <h3 className="font-bold text-white mb-1">{t("services.topItems.title")}</h3>
          <p className="text-[11px] text-slate-500 mb-4">{t("services.topItems.subtitle")}</p>
          {data.topItems.length === 0 ? (
            <p className="text-sm text-admin-muted text-center py-8">{t("services.topItems.empty")}</p>
          ) : (
            <div className="space-y-2">
              {data.topItems.map((row, i) => (
                <MetricCardRow
                  key={`${row.itemId}-${i}`}
                  label={
                    <span className="flex items-baseline gap-1.5">
                      <span className="shrink-0 text-[10px] text-slate-500">{t(`services.types.${row.type}`)}</span>
                      <span className="truncate">{row.label}</span>
                    </span>
                  }
                  count={`${row.quantity} ${t("services.topItems.qty")}`}
                  metrics={[
                    { label: t("services.topItems.revenueKrw"), value: row.revenueKrwText, className: "text-admin-krw" },
                    { label: t("services.topItems.revenueVnd"), value: row.revenueVndText, className: "text-admin-vnd font-medium" },
                  ]}
                />
              ))}
            </div>
          )}
        </div>

        <div className="col-span-12 xl:col-span-6 bg-admin-card rounded-xl border border-slate-700/50 p-5">
          <h3 className="font-bold text-white mb-1">{t("services.topVendors.title")}</h3>
          <p className="text-[11px] text-slate-500 mb-4">{t("services.topVendors.subtitle")}</p>
          {data.topVendors.length === 0 ? (
            <p className="text-sm text-admin-muted text-center py-8">{t("services.topVendors.empty")}</p>
          ) : (
            <div className="space-y-2">
              {data.topVendors.map((row, i) => (
                <MetricCardRow
                  key={`${row.vendorId}-${i}`}
                  label={<span className="truncate">{row.name}</span>}
                  count={`${row.orderCount} ${t("services.topVendors.orders")}`}
                  metrics={[
                    { label: t("services.topVendors.revenueVnd"), value: row.revenueVndText, className: "text-admin-vnd font-medium" },
                    { label: t("services.topVendors.payoutVnd"), value: row.payoutVndText, className: "text-amber-300/90" },
                  ]}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 모바일 최적화 통계 카드 1행 — 이름(위) + 지표 2열 그리드(아래). 큰 금액도 가로 넘침 없이 표시.
//   metrics 2개=한 줄, 3개=2+1 줄로 자연 줄바꿈. 표(table) 가로 스크롤 대체.
function MetricCardRow({
  label,
  count,
  metrics,
}: {
  label: ReactNode;
  count?: ReactNode;
  metrics: Array<{ label: string; value: string; className?: string }>;
}) {
  return (
    <div className="rounded-lg bg-slate-800/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-medium text-slate-200">{label}</div>
        {count != null && <div className="shrink-0 text-xs text-slate-400 tabular-nums">{count}</div>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        {metrics.map((m, i) => (
          <div key={i} className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{m.label}</p>
            <p className={`truncate text-sm tabular-nums ${m.className ?? "text-slate-200"}`}>{m.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 개요 탭 하위. 미니바 판매 섹션 (canViewFinance 전용) ───────────
function MinibarSection({ data }: { data: MinibarStats }) {
  const t = useTranslations("adminStatistics");
  const hasMargin = data.marginVnd != null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 pt-2">
        <span className="material-symbols-outlined text-emerald-400 text-lg">local_bar</span>
        <h2 className="text-base font-bold text-white">{t("minibar.title")}</h2>
        <span className="text-[11px] text-slate-500">{t("minibar.subtitle")}</span>
      </div>

      {/* KPI: 미니바 매출 + 마진(null이면 원가 미입력 배지) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <KpiCard
          label={t("minibar.kpi.revenue")}
          value={data.revenueVndText}
          accent="vnd"
          icon="local_bar"
          iconClassName="text-admin-vnd"
          footer={
            <p className="text-[10px] text-slate-500">{t("minibar.kpi.revenueNote")}</p>
          }
        />
        <div className="bg-admin-card p-4 rounded-xl border border-slate-700/50">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-medium text-admin-muted uppercase tracking-wider">
              {t("minibar.kpi.margin")}
            </span>
            <span className="material-symbols-outlined text-amber-400">savings</span>
          </div>
          {hasMargin ? (
            <>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white tabular-nums">
                  {data.marginVndText}
                </span>
              </div>
              {data.costMissingCount > 0 && (
                <p className="mt-2 text-[10px] text-slate-500">
                  {t("minibar.kpi.marginPartialNote", { count: data.costMissingCount })}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-amber-400/90 bg-amber-500/10 px-2 py-1 rounded">
                  <span className="material-symbols-outlined text-[14px]">price_change</span>
                  {t("minibar.kpi.costMissing")}
                </span>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {t("minibar.kpi.costMissingNote", { count: data.costMissingCount })}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* 추이 막대 */}
        <div className="col-span-12 xl:col-span-7 bg-admin-card rounded-xl border border-slate-700/50 p-5">
          <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-white">{t("minibar.trendChart.title")}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">{t("minibar.trendChart.subtitle")}</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <span className="w-3 h-3 rounded-sm bg-admin-vnd" />
              {t("minibar.trendChart.legend")}
            </div>
          </div>
          <MinibarChart data={data.trend} legend={t("minibar.trendChart.legend")} />
        </div>

        {/* 품목별 top */}
        <div className="col-span-12 xl:col-span-5 bg-admin-card rounded-xl border border-slate-700/50 p-5">
          <h3 className="font-bold text-white mb-4">{t("minibar.topItems.title")}</h3>
          {data.topItems.length === 0 ? (
            <p className="text-sm text-admin-muted text-center py-8">{t("minibar.topItems.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-admin-muted uppercase tracking-wider border-b border-slate-700/50">
                  <th className="text-left font-medium py-2">{t("minibar.topItems.name")}</th>
                  <th className="text-right font-medium py-2">{t("minibar.topItems.qty")}</th>
                  <th className="text-right font-medium py-2">{t("minibar.topItems.revenue")}</th>
                </tr>
              </thead>
              <tbody>
                {data.topItems.slice(0, 10).map((item, i) => (
                  <tr key={`${item.nameKo}-${i}`} className="border-b border-slate-800/60 last:border-0">
                    <td className="py-2 text-slate-200 truncate max-w-[10rem]">{item.nameKo}</td>
                    <td className="py-2 text-right text-slate-400 tabular-nums">{item.consumedQty}</td>
                    <td className="py-2 text-right text-white tabular-nums font-medium">
                      {item.revenueVndText}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 탭2. 가동률 ──────────────────────────────────────────────
function OccupancyTab({ data }: { data: OccupancyStats }) {
  const t = useTranslations("adminStatistics");
  const prevRate =
    data.changePct != null
      ? Math.round((data.currentRatePct - data.changePct) * 10) / 10
      : null;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-admin-card p-4 rounded-xl border-l-4 border-l-admin-primary border border-slate-700/50">
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-medium text-admin-muted uppercase tracking-wider">
              {t("occupancy.kpi.currentRate")}
            </span>
            <span className="material-symbols-outlined text-admin-primary">donut_large</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-white tabular-nums">{data.currentRatePct}</span>
            <span className="text-sm text-admin-muted">%</span>
          </div>
          <div className="mt-3 h-2 w-full bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-admin-primary rounded-full"
              style={{ width: `${Math.min(data.currentRatePct, 100)}%` }}
            />
          </div>
        </div>

        <KpiCard
          label={t("occupancy.kpi.change")}
          value={data.changePct != null ? `${data.changePct >= 0 ? "+" : ""}${data.changePct}` : "-"}
          unit={data.changePct != null ? "%p" : undefined}
          icon="trending_up"
          iconClassName="text-emerald-500"
          footer={
            prevRate != null ? (
              <p className="text-[11px] text-slate-500">
                {t("occupancy.kpi.changeNote", { prev: prevRate, current: data.currentRatePct })}
              </p>
            ) : undefined
          }
        />

        <KpiCard
          label={t("occupancy.kpi.avgNights")}
          value={data.avgNights}
          unit={t("common.nightsUnit")}
          icon="hotel"
          iconClassName="text-indigo-400"
          footer={
            <p className="text-[11px] text-slate-500">
              {t("occupancy.kpi.avgNightsNote", {
                bookings: data.bookingCount,
                nights: data.villas.reduce((s, v) => s + v.occupiedNights, 0),
              })}
            </p>
          }
        />
      </div>

      <div className="bg-admin-card rounded-xl border border-slate-700/50 p-5">
        <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
          <div>
            <h3 className="font-bold text-white">{t("occupancy.trendChart.title")}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("occupancy.trendChart.subtitle")}</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <span className="w-3 h-3 rounded-sm bg-admin-primary" />
            {t("occupancy.trendChart.legend")}
          </div>
        </div>
        <OccupancyLine data={data.trend} legend={t("occupancy.trendChart.legend")} />
      </div>

      <VillaOccupancyBars villas={data.villas} />
    </>
  );
}

function VillaOccupancyBars({
  villas,
}: {
  villas: OccupancyStats["villas"];
}) {
  const t = useTranslations("adminStatistics");
  const complexes = useMemo(() => {
    const set = new Set<string>();
    for (const v of villas) if (v.complex) set.add(v.complex);
    return [...set].sort();
  }, [villas]);
  const [complex, setComplex] = useState<string>("");

  const filtered = complex ? villas.filter((v) => v.complex === complex) : villas;

  return (
    <div className="bg-admin-card rounded-xl border border-slate-700/50 p-5">
      <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
        <h3 className="font-bold text-white">{t("occupancy.villaChart.title")}</h3>
        <select
          aria-label={t("occupancy.villaChart.allComplexes")}
          value={complex}
          onChange={(e) => setComplex(e.target.value)}
          className="bg-slate-900 border-slate-700 rounded-lg text-xs text-slate-200 py-1.5 pl-3 pr-8 focus:ring-admin-primary focus:border-admin-primary"
        >
          <option value="">{t("occupancy.villaChart.allComplexes")}</option>
          {complexes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-admin-muted text-center py-6">{t("common.noData")}</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((v) => (
            <div key={v.villaId} className="flex items-center gap-3">
              <div className="w-32 sm:w-40 shrink-0 text-sm text-slate-200 truncate">
                {v.name}
                {v.complex && <span className="text-[10px] text-slate-500"> · {v.complex}</span>}
              </div>
              <div className="flex-1 h-6 bg-slate-700/40 rounded overflow-hidden">
                <div
                  className={`h-full rounded flex items-center justify-end pr-2 ${
                    v.ratePct >= 50 ? "bg-admin-primary" : "bg-slate-600"
                  }`}
                  style={{ width: `${Math.max(v.ratePct, 6)}%` }}
                >
                  <span className="text-[10px] font-bold text-white tabular-nums">{v.ratePct}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 탭3. 빌라 성과 ───────────────────────────────────────────
function VillasTab({
  rows,
  hasFinance,
}: {
  rows: VillaPerformanceRow[];
  hasFinance: boolean;
}) {
  const t = useTranslations("adminStatistics");
  return (
    <VillaRankTable
      rows={rows}
      hasFinance={hasFinance}
      labels={{
        gateNote: t("villas.gateNote"),
        topTitle: t("villas.topChart.title"),
        byRate: t("villas.topChart.byRate"),
        byBookings: t("villas.topChart.byBookings"),
        byRevenue: t("villas.topChart.byRevenue"),
        tableTitle: t("villas.table.title"),
        hint: t("villas.table.hint"),
        name: t("villas.table.name"),
        complex: t("villas.table.complex"),
        bookings: t("villas.table.bookings"),
        nights: t("villas.table.nights"),
        rate: t("villas.table.rate"),
        krwRevenue: t("villas.table.krwRevenue"),
        vndRevenue: t("villas.table.vndRevenue"),
        margin: t("villas.table.margin"),
        marginRef: t("villas.table.marginRef"),
        noComplex: t("villas.table.noComplex"),
        noData: t("common.noData"),
      }}
    />
  );
}

// ── 탭4. 운영지표 ────────────────────────────────────────────
function OperationsTab({
  data,
  funnel,
  fin,
}: {
  data: OperationsStats;
  funnel: FunnelStats;
  fin: boolean;
}) {
  const t = useTranslations("adminStatistics");

  const RatioCard = ({
    label,
    value,
    note,
    icon,
    iconClassName,
  }: {
    label: string;
    value: number;
    note: ReactNode;
    icon: string;
    iconClassName: string;
  }) => (
    <div className="bg-admin-card p-4 rounded-xl border border-slate-700/50">
      <div className="flex justify-between items-start mb-2">
        <span className="text-xs font-medium text-admin-muted uppercase tracking-wider">{label}</span>
        <span className={`material-symbols-outlined ${iconClassName}`}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold text-white tabular-nums">{value}</span>
        <span className="text-sm text-admin-muted">%</span>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{note}</p>
    </div>
  );

  return (
    <>
      <Funnel
        steps={funnel.steps}
        labels={{
          title: t("operations.funnel.title"),
          subtitle: t("operations.funnel.subtitle"),
          steps: {
            proposals: t("operations.funnel.proposals"),
            reserved: t("operations.funnel.reserved"),
            confirmed: t("operations.funnel.confirmed"),
            checkedOut: t("operations.funnel.checkedOut"),
          },
          overallLabel: t("operations.funnel.overallLabel"),
        }}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RatioCard
          label={t("operations.ratios.holdExpiry")}
          value={data.holdExpiryPct}
          note={t("operations.ratios.holdExpiryNote", {
            created: data.holdCreatedCount,
            expired: data.holdExpiredCount,
          })}
          icon="hourglass_disabled"
          iconClassName="text-amber-500"
        />
        <RatioCard
          label={t("operations.ratios.cancel")}
          value={data.cancelPct}
          note={t("operations.ratios.cancelNote")}
          icon="cancel"
          iconClassName="text-red-400"
        />
        <RatioCard
          label={t("operations.ratios.noShow")}
          value={data.noShowPct}
          note={t("operations.ratios.noShowNote")}
          icon="person_off"
          iconClassName="text-orange-400"
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 bg-admin-card rounded-xl border border-slate-700/50 p-5">
          <h3 className="font-bold text-white mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-400 text-lg">cleaning_services</span>
            {t("operations.cleaning.title")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg bg-slate-900/40">
              <span className="material-symbols-outlined text-blue-400">timer</span>
              <div className="mt-1 text-2xl font-bold text-white tabular-nums">
                {data.cleaning.avgTurnaroundHours ?? "-"}
                {data.cleaning.avgTurnaroundHours != null && (
                  <span className="text-sm text-admin-muted">{t("operations.cleaning.hoursUnit")}</span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{t("operations.cleaning.avgTurnaround")}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-slate-900/40">
              <span className="material-symbols-outlined text-amber-400">pending_actions</span>
              <div className="mt-1 text-2xl font-bold text-white tabular-nums">
                {data.cleaning.pendingCount}
                <span className="text-sm text-admin-muted">{t("common.bookingsUnit")}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{t("operations.cleaning.pending")}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-slate-900/40">
              <span className="material-symbols-outlined text-red-400">thumb_down</span>
              <div className="mt-1 text-2xl font-bold text-white tabular-nums">
                {data.cleaning.rejectRatePct}
                <span className="text-sm text-admin-muted">%</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{t("operations.cleaning.rejectRate")}</p>
            </div>
          </div>
        </div>

        {/* 보증금 차감 — fin=true & deposit 존재 시만 (페이로드에 없으면 카드 자체 미존재) */}
        {fin && data.deposit && (
          <div className="col-span-12 lg:col-span-4 bg-admin-card rounded-xl border border-slate-700/50 p-5">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-orange-400 text-lg">price_change</span>
                {t("operations.deposit.title")}
              </h3>
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/80 bg-amber-500/10 px-1.5 py-0.5 rounded">
                <span className="material-symbols-outlined text-[11px]">lock</span>
                {t("operations.deposit.gateBadge")}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-orange-300 tabular-nums">
                {formatThousands(data.deposit.deductVnd)}
              </span>
              <span className="text-sm text-admin-muted">₫</span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {t("operations.deposit.note", { count: data.deposit.deductedCount })}
            </p>
            <p className="mt-1 text-[10px] text-slate-600">{t("operations.deposit.staffNote")}</p>
          </div>
        )}
      </div>
    </>
  );
}
