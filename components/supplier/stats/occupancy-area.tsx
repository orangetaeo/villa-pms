"use client";

// 공급자 가동율 추이 라인/영역 차트 (라이트 teal, 0~100%) — T-supplier-statistics
// 금액 없음. 라벨은 서버(props)가 번역해 전달.
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

const TEAL = "#0d9488";
const GRID = "#e2e8f0";
const AXIS = "#64748b";

export interface OccupancyAreaRow {
  label: string;
  ratePct: number;
}

function OccTooltip({
  active,
  payload,
  legend,
}: {
  active?: boolean;
  payload?: Array<{ payload: OccupancyAreaRow }>;
  legend: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-0.5 font-bold text-slate-900 tabular-nums">{row.label}</p>
      <p className="flex items-center gap-1.5 text-slate-600">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TEAL }} />
        {legend}
        <span className="ml-auto pl-3 font-bold tabular-nums text-teal-700">{row.ratePct}%</span>
      </p>
    </div>
  );
}

export default function OccupancyArea({
  data,
  legend,
}: {
  data: OccupancyAreaRow[];
  legend: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="supOccFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL} stopOpacity={0.22} />
            <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tick={{ fill: AXIS, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={36}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip cursor={{ stroke: GRID }} content={<OccTooltip legend={legend} />} />
        <Area type="monotone" dataKey="ratePct" stroke="none" fill="url(#supOccFill)" />
        <Line
          type="monotone"
          dataKey="ratePct"
          stroke={TEAL}
          strokeWidth={2}
          dot={{ r: 2, fill: TEAL }}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
