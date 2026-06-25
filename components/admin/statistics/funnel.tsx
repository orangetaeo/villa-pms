"use client";

// 제안 전환 깔때기 (T-admin-statistics §5 탭4, Stitch b17 4-stage funnel)
// 4단계 막대(높이=상대값) + 단계별 전환율% + 전체 전환율. 금액 없음(전 운영자).
// 디자인 변환 주: Stitch는 recharts FunnelChart 자리표시였으나, 단계 라벨·전환율 화살표가
//   핵심이라 커스텀 계단 막대로 구현(시각 동일, 반응형 <768 세로 스택 용이).

import type { FunnelStep } from "@/lib/statistics";

export interface FunnelLabels {
  title: string;
  subtitle: string;
  steps: Record<FunnelStep["key"], string>;
  overallLabel: string;
}

const STAGE_BG: Record<FunnelStep["key"], string> = {
  proposals: "bg-admin-primary",
  reserved: "bg-admin-primary/85",
  confirmed: "bg-admin-primary/70",
  checkedOut: "bg-admin-vnd",
};

const STAGE_HEIGHT = ["h-28", "h-24 mt-2", "h-20 mt-4", "h-16 mt-6"];

export default function Funnel({
  steps,
  labels,
}: {
  steps: FunnelStep[];
  labels: FunnelLabels;
}) {
  const first = steps[0]?.count ?? 0;
  const last = steps[steps.length - 1]?.count ?? 0;
  // 전체 전환율 = 마지막 / 첫 단계
  const overallPct = first > 0 ? Math.round((last / first) * 1000) / 10 : 0;

  return (
    <div className="bg-admin-card rounded-xl border border-slate-700/50 p-5">
      <div className="flex justify-between items-center mb-5">
        <div>
          <h3 className="font-bold text-white">{labels.title}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">{labels.subtitle}</p>
        </div>
      </div>

      {/* 데스크톱: 가로 계단 / <768: 세로 스택 */}
      <div className="flex flex-col md:flex-row md:items-stretch gap-2">
        {steps.map((step, i) => (
          <div key={step.key} className="contents md:flex md:flex-1 md:items-stretch">
            <div className="flex-1 flex flex-col items-center">
              <div
                className={`w-full rounded-lg ${STAGE_BG[step.key]} ${STAGE_HEIGHT[i] ?? "h-20"} flex flex-col items-center justify-center text-white`}
              >
                <span className="text-2xl font-bold tabular-nums">{step.count}</span>
                <span className="text-[11px] opacity-90">{labels.steps[step.key]}</span>
              </div>
            </div>
            {/* 전환율 화살표 (마지막 단계 제외) */}
            {i < steps.length - 1 && (
              <div className="flex items-center justify-center md:px-1">
                <div className="text-center px-1 flex md:block items-center gap-1">
                  <span className="material-symbols-outlined text-slate-500 rotate-90 md:rotate-0">
                    chevron_right
                  </span>
                  <div className="text-[10px] text-emerald-400 font-bold tabular-nums">
                    {steps[i + 1].conversionPct ?? 0}%
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between text-[11px]">
        <span className="text-slate-500">{labels.overallLabel}</span>
        <span className="text-white font-bold tabular-nums">{overallPct}%</span>
      </div>
    </div>
  );
}
