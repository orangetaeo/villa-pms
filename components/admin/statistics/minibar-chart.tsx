"use client";

// 미니바 매출 추이 — VND 단일 계열 (T-admin-statistics 통계 v2, canViewFinance 전용)
// ★ 미니바는 VND 고정(통화 합산 이슈 없음 — ADR-0003 무관). 에메랄드 계열(VND 색).
//   라벨은 로더(StatsPeriod.buckets)가 제공(일='MM-DD', 월='YYYY-MM'). 정확표시는 *Text.
// 표현: 부드러운 영역(monotone 곡선, 오버슈트 방지) + 그라데이션 채움 + 점선 그리드 (막대 → 영역 곡선, 매출 추이와 통일).

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MinibarTrendPoint } from "@/lib/statistics";

const VND = "#10B981"; // admin-vnd 에메랄드
const GRID = "#33415533";
const AXIS = "#64748B";

function MinibarTooltip({
  active,
  payload,
  legend,
}: {
  active?: boolean;
  payload?: Array<{ payload: MinibarTrendPoint }>;
  legend: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-bold text-white tabular-nums">{row.label}</p>
      <p className="flex items-center gap-1.5 text-slate-300">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: VND }} />
        {legend}
        <span className="ml-auto pl-3 tabular-nums text-white">{row.revenueVndText}</span>
      </p>
    </div>
  );
}

export default function MinibarChart({
  data,
  legend,
}: {
  data: MinibarTrendPoint[];
  legend: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="minibarFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={VND} stopOpacity={0.28} />
            <stop offset="100%" stopColor={VND} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* 점선 그리드(가로·세로) — 매출 추이와 통일 */}
        <CartesianGrid stroke={GRID} strokeDasharray="4 4" />
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#334155" }}
        />
        <YAxis
          tick={{ fill: VND, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => (v >= 1_000_000 ? `${Math.round(v / 1_000_000)}M` : `${v}`)}
        />
        <Tooltip cursor={{ stroke: "#334155" }} content={<MinibarTooltip legend={legend} />} />
        <Area
          type="monotone"
          dataKey="revenueVnd"
          name={legend}
          stroke={VND}
          strokeWidth={2.5}
          fill="url(#minibarFill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
