"use client";

// 월별 가동률 추이 라인 (T-admin-statistics §5 탭2, Stitch b17 LineChart 0~100%)
// 최근 12개월, y축 0~100% 고정. 금액 없음(전 운영자).

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OccupancyTrendPoint } from "@/lib/statistics";

const BLUE = "#3B82F6";
const GRID = "#33415533";
const AXIS = "#64748B";

// 라벨은 로더(StatsPeriod.buckets)가 제공한다(일='MM-DD', 월='YYYY-MM').
type ChartRow = OccupancyTrendPoint;

function OccTooltip({
  active,
  payload,
  legend,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  legend: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-0.5 font-bold text-white tabular-nums">{row.label}</p>
      <p className="flex items-center gap-1.5 text-slate-300">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: BLUE }} />
        {legend}
        <span className="ml-auto pl-3 tabular-nums text-white">{row.ratePct}%</span>
      </p>
    </div>
  );
}

export default function OccupancyLine({
  data,
  legend,
}: {
  data: OccupancyTrendPoint[];
  legend: string;
}) {
  const rows: ChartRow[] = data;

  return (
    <ResponsiveContainer width="100%" height={256}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="occFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BLUE} stopOpacity={0.25} />
            <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: "#334155" }}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tick={{ fill: AXIS, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip cursor={{ stroke: "#334155" }} content={<OccTooltip legend={legend} />} />
        <Area type="monotone" dataKey="ratePct" stroke="none" fill="url(#occFill)" />
        <Line
          type="monotone"
          dataKey="ratePct"
          stroke={BLUE}
          strokeWidth={2}
          dot={{ r: 2, fill: BLUE }}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
