"use client";

// 월별 매출 추이 — KRW·VND 분리 2계열 (T-admin-statistics §5 탭1, Stitch b17 dual-axis)
// ★ 통화 합산 금지(ADR-0003): KRW=좌축(블루), VND=우축(에메랄드) 별도 축으로 시각 분리.
//   같은 축에 두지 않아 "합쳐 보이는" 오인을 막는다. 정확표시는 *Text 사용.

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyRevenuePoint } from "@/lib/statistics";

const KRW = "#3B82F6"; // admin-krw
const VND = "#10B981"; // admin-vnd
const GRID = "#33415533";
const AXIS = "#64748B";

/** monthKey "YYYY-MM" → "MM"(또는 연 전환 시 "YY.MM") 짧은 라벨 */
function shortMonth(monthKey: string, prevKey?: string): string {
  const [y, m] = monthKey.split("-");
  if (!prevKey || prevKey.split("-")[0] !== y) return `${y.slice(2)}.${m}`;
  return m;
}

interface ChartRow extends MonthlyRevenuePoint {
  label: string;
}

function RevenueTooltip({
  active,
  payload,
  krwLegend,
  vndLegend,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  krwLegend: string;
  vndLegend: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-bold text-white tabular-nums">{row.label}</p>
      <p className="flex items-center gap-1.5 text-slate-300">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: KRW }} />
        {krwLegend}
        <span className="ml-auto pl-3 tabular-nums text-white">{row.krwRevenueText}</span>
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-slate-300">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: VND }} />
        {vndLegend}
        <span className="ml-auto pl-3 tabular-nums text-white">{row.vndRevenueText}</span>
      </p>
    </div>
  );
}

export default function RevenueChart({
  data,
  krwLegend,
  vndLegend,
}: {
  data: MonthlyRevenuePoint[];
  krwLegend: string;
  vndLegend: string;
}) {
  const rows: ChartRow[] = data.map((d, i) => ({
    ...d,
    label: shortMonth(d.monthKey, data[i - 1]?.monthKey),
  }));

  return (
    <ResponsiveContainer width="100%" height={288}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#334155" }}
        />
        {/* 좌축 = KRW(원), 우축 = VND(₫) — 별도 스케일로 통화 분리 */}
        <YAxis
          yAxisId="krw"
          orientation="left"
          tick={{ fill: KRW, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => (v >= 1_000_000 ? `${Math.round(v / 1_000_000)}M` : `${v}`)}
        />
        <YAxis
          yAxisId="vnd"
          orientation="right"
          tick={{ fill: VND, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => (v >= 1_000_000 ? `${Math.round(v / 1_000_000)}M` : `${v}`)}
        />
        <Tooltip
          cursor={{ fill: "#33415533" }}
          content={<RevenueTooltip krwLegend={krwLegend} vndLegend={vndLegend} />}
        />
        <Bar yAxisId="krw" dataKey="krwRevenue" name={krwLegend} fill={KRW} radius={[3, 3, 0, 0]} />
        <Bar yAxisId="vnd" dataKey="vndRevenue" name={vndLegend} fill={VND} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
