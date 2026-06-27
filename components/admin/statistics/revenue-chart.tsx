"use client";

// 월별 매출 추이 — KRW·VND 분리 2계열 (T-admin-statistics §5 탭1)
// ★ 통화 합산 금지(ADR-0003): KRW=좌축(블루), VND=우축(에메랄드) 별도 축으로 시각 분리.
//   같은 축에 두지 않아 "합쳐 보이는" 오인을 막는다. 정확표시는 *Text 사용.
// 표현: 부드러운 영역(natural 스플라인) + 그라데이션 채움 + 점선 그리드 (막대 → 영역 곡선으로 변경).

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RevenueTrendPoint } from "@/lib/statistics";

const KRW = "#3B82F6"; // admin-krw
const VND = "#10B981"; // admin-vnd
const GRID = "#33415533";
const AXIS = "#64748B";

// 라벨은 로더(StatsPeriod.buckets)가 제공한다(일='MM-DD', 월='YYYY-MM').
type ChartRow = RevenueTrendPoint;

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
  data: RevenueTrendPoint[];
  krwLegend: string;
  vndLegend: string;
}) {
  const rows: ChartRow[] = data;

  return (
    <ResponsiveContainer width="100%" height={288}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {/* 곡선 아래 그라데이션(상단 채움 → 하단 투명) — 이미지 양식 */}
          <linearGradient id="revKrwFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={KRW} stopOpacity={0.28} />
            <stop offset="100%" stopColor={KRW} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="revVndFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={VND} stopOpacity={0.28} />
            <stop offset="100%" stopColor={VND} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* 점선 그리드(가로·세로) — 이미지 양식 */}
        <CartesianGrid stroke={GRID} strokeDasharray="4 4" />
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#334155" }}
        />
        {/* 좌축 = KRW(원), 우축 = VND(₫) — 별도 스케일로 통화 분리(ADR-0003) */}
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
          cursor={{ stroke: "#334155" }}
          content={<RevenueTooltip krwLegend={krwLegend} vndLegend={vndLegend} />}
        />
        <Area
          yAxisId="krw"
          type="natural"
          dataKey="krwRevenue"
          name={krwLegend}
          stroke={KRW}
          strokeWidth={2.5}
          fill="url(#revKrwFill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Area
          yAxisId="vnd"
          type="natural"
          dataKey="vndRevenue"
          name={vndLegend}
          stroke={VND}
          strokeWidth={2.5}
          fill="url(#revVndFill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
