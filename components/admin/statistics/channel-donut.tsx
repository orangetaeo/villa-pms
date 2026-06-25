"use client";

// 채널별 비중 도넛 (T-admin-statistics §5 탭1, Stitch b17 PieChart donut)
// 건수/매출 토글. ★ 매출 모드도 통화 합산 금지 — 도넛은 "건수" 또는 단일 통화 비중만 표현.
//   매출 모드는 통화가 섞이지 않도록 KRW·VND를 각각 표기(레전드 텍스트)하고, 도넛 비중은 건수 기준 유지.
//   (통화 합산 도넛은 ADR-0003 위반이므로 만들지 않음 — 매출 토글은 레전드 금액 표기 전환만 수행.)

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ChannelStat } from "@/lib/statistics";

const CHANNEL_COLORS: Record<string, string> = {
  TRAVEL_AGENCY: "#3B82F6",
  LAND_AGENCY: "#10B981",
  DIRECT: "#F59E0B",
};

export interface ChannelDonutLabels {
  title: string;
  byCount: string;
  byRevenue: string;
  totalBookings: string;
  bookingsUnit: string;
  channelName: (channel: string) => string;
}

export default function ChannelDonut({
  channels,
  labels,
}: {
  channels: ChannelStat[];
  labels: ChannelDonutLabels;
}) {
  const [mode, setMode] = useState<"count" | "revenue">("count");
  const totalCount = channels.reduce((s, c) => s + c.bookingCount, 0);

  // 도넛 비중은 항상 건수 기준(통화 비합산 원칙). 0건이면 빈 도넛.
  const pieData = channels
    .filter((c) => c.bookingCount > 0)
    .map((c) => ({
      channel: c.channel,
      name: labels.channelName(c.channel),
      value: c.bookingCount,
      color: CHANNEL_COLORS[c.channel] ?? "#64748B",
    }));

  const pct = (n: number) => (totalCount > 0 ? Math.round((n / totalCount) * 100) : 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-white">{labels.title}</h3>
        <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-[10px]">
          <button
            type="button"
            onClick={() => setMode("count")}
            className={
              mode === "count"
                ? "px-2 py-1 rounded bg-admin-primary text-white font-bold"
                : "px-2 py-1 rounded text-slate-400 hover:text-white font-medium"
            }
          >
            {labels.byCount}
          </button>
          <button
            type="button"
            onClick={() => setMode("revenue")}
            className={
              mode === "revenue"
                ? "px-2 py-1 rounded bg-admin-primary text-white font-bold"
                : "px-2 py-1 rounded text-slate-400 hover:text-white font-medium"
            }
          >
            {labels.byRevenue}
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center">
        <div className="relative h-44 w-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={86}
                paddingAngle={pieData.length > 1 ? 2 : 0}
                stroke="none"
              >
                {pieData.map((d) => (
                  <Cell key={d.channel} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                cursor={false}
                contentStyle={{
                  background: "rgba(15,23,42,0.95)",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                itemStyle={{ color: "#fff" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-white tabular-nums">{totalCount}</span>
            <span className="text-[10px] text-slate-500">{labels.totalBookings}</span>
          </div>
        </div>

        <div className="mt-5 w-full space-y-2 text-xs">
          {channels.map((c) => (
            <div key={c.channel} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-slate-300">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: CHANNEL_COLORS[c.channel] ?? "#64748B" }}
                />
                {labels.channelName(c.channel)}
              </span>
              <span className="text-slate-400 tabular-nums">
                {mode === "count"
                  ? `${c.bookingCount}${labels.bookingsUnit} · ${pct(c.bookingCount)}%`
                  : // 매출 모드 — 통화별 분리 표기(합산 안 함)
                    `${c.krwRevenueText} · ${c.vndRevenueText}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
