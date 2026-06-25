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
} from "@/lib/statistics";
import { formatThousands } from "@/lib/format";
import KpiCard from "@/components/admin/statistics/kpi-card";
import RevenueChart from "@/components/admin/statistics/revenue-chart";
import ChannelDonut from "@/components/admin/statistics/channel-donut";
import OccupancyLine from "@/components/admin/statistics/occupancy-line";
import VillaRankTable from "@/components/admin/statistics/villa-rank-table";
import Funnel from "@/components/admin/statistics/funnel";

export type TabKey = "overview" | "occupancy" | "villas" | "operations";

export interface StatisticsProps {
  fin: boolean;
  activeTab: TabKey;
  range: string; // "6" | "12" | "YYYY"
  /** fin=true일 때만 존재 — 없으면 개요 탭 자체 미노출 */
  overview?: OverviewStats;
  occupancy: OccupancyStats;
  villas: VillaPerformanceRow[];
  funnel: FunnelStats;
  operations: OperationsStats;
}

const ALL_TABS: TabKey[] = ["overview", "occupancy", "villas", "operations"];
const TAB_ICONS: Record<TabKey, string> = {
  overview: "payments",
  occupancy: "event_available",
  villas: "leaderboard",
  operations: "conversion_path",
};

const RANGE_PRESETS = ["6", "12"] as const;

export default function StatisticsClient(props: StatisticsProps) {
  const t = useTranslations("adminStatistics");
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabs = useMemo(
    () => (props.fin ? ALL_TABS : ALL_TABS.filter((x) => x !== "overview")),
    [props.fin]
  );

  const [tab, setTab] = useState<TabKey>(
    tabs.includes(props.activeTab) ? props.activeTab : tabs[0]
  );

  const updateQuery = useCallback(
    (next: { tab?: TabKey; range?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.tab) params.set("tab", next.tab);
      if (next.range) params.set("range", next.range);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const onTab = (next: TabKey) => {
    setTab(next);
    updateQuery({ tab: next });
  };

  // 기간 변경은 서버 재집계가 필요하므로 router.replace로 RSC 재요청(데이터 갱신)
  const onRange = (next: string) => updateQuery({ tab, range: next });

  const isYearRange = !RANGE_PRESETS.includes(props.range as "6" | "12");
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

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

        {/* 기간 필터 */}
        <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-1 mb-2 border border-slate-800">
          {RANGE_PRESETS.map((r) => {
            const active = !isYearRange && props.range === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => onRange(r)}
                className={
                  active
                    ? "px-3 py-1 text-xs font-bold rounded bg-admin-primary text-white"
                    : "px-3 py-1 text-xs font-medium rounded text-slate-400 hover:text-white"
                }
              >
                {t(`range.${r}`)}
              </button>
            );
          })}
          <select
            aria-label={t("range.year")}
            value={isYearRange ? props.range : ""}
            onChange={(e) => e.target.value && onRange(e.target.value)}
            className={`bg-transparent border-0 text-xs rounded px-2 py-1 focus:ring-0 ${
              isYearRange ? "text-white font-bold" : "text-slate-400"
            }`}
          >
            <option value="" disabled>
              {t("range.year")}
            </option>
            {yearOptions.map((y) => (
              <option key={y} value={String(y)} className="bg-slate-900 text-white">
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="py-6 space-y-6">
        {tab === "overview" && props.overview && (
          <OverviewTab data={props.overview} />
        )}
        {tab === "occupancy" && <OccupancyTab data={props.occupancy} />}
        {tab === "villas" && (
          <VillasTab rows={props.villas} hasFinance={props.fin} />
        )}
        {tab === "operations" && (
          <OperationsTab data={props.operations} funnel={props.funnel} fin={props.fin} />
        )}
      </div>
    </div>
  );
}

// ── 탭1. 개요 ────────────────────────────────────────────────
function OverviewTab({ data }: { data: OverviewStats }) {
  const t = useTranslations("adminStatistics");
  const k = data.current;
  const fxMissing = data.monthly.reduce((s, m) => s + m.fxMissingCount, 0);

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
            data={data.monthly}
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
    </>
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
        <OccupancyLine data={data.monthly} legend={t("occupancy.trendChart.legend")} />
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
