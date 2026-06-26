"use client";

// 공급자 수익 추이 막대 차트 (라이트 teal, VND only) — T-supplier-statistics
// 금액은 supplierCostVnd 합(수익)뿐. 판매가·마진 축 없음. 라벨은 서버(props)가 번역해 전달.
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TEAL = "#0d9488"; // teal-600 (공급자 라이트 브랜드)
const GRID = "#e2e8f0"; // slate-200
const AXIS = "#64748b"; // slate-500

export interface RevenueBarRow {
  label: string;
  vnd: number;
  vndText: string;
}

/** VND 축 압축 표기: 1.000.000 단위 → "45tr" (triệu). 0이면 "0". */
function compactVnd(v: number): string {
  if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}tr`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return `${v}`;
}

function RevenueTooltip({
  active,
  payload,
  legend,
}: {
  active?: boolean;
  payload?: Array<{ payload: RevenueBarRow }>;
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
        <span className="ml-auto pl-3 font-bold tabular-nums text-teal-700">{row.vndText}</span>
      </p>
    </div>
  );
}

export default function RevenueBar({
  data,
  legend,
}: {
  data: RevenueBarRow[];
  legend: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={compactVnd}
        />
        <Tooltip
          cursor={{ fill: "#0d948811" }}
          content={<RevenueTooltip legend={legend} />}
        />
        <Bar dataKey="vnd" fill={TEAL} radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}
