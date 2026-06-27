"use client";

// 통계 공통 KPI 카드 (T-admin-statistics §5, Stitch b17 KPI 카드)
// 값 + 단위 + 전월 대비 증감(▲/▼). changePct null이면 증감 줄 미표시.
// 색·여백은 b17 export 기준(다크 admin 토큰). 좌측 강조 보더는 accent로 선택.

import type { ReactNode } from "react";

export type KpiAccent = "krw" | "vnd" | "none";

export default function KpiCard({
  label,
  value,
  unit,
  changePct,
  changeSuffix = "%",
  changeFromLabel,
  accent = "none",
  icon,
  iconClassName,
  footer,
  /** 증감 방향 해석을 반대로(낮을수록 좋음 등) — 통계엔 기본 정방향 */
  invertChange = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  /** 전월 대비 증감률(%) — null이면 줄 숨김 */
  changePct?: number | null;
  /** 증감 단위 접미(기본 %, 가동률은 %p) */
  changeSuffix?: string;
  changeFromLabel?: string;
  accent?: KpiAccent;
  icon?: string;
  iconClassName?: string;
  footer?: ReactNode;
  invertChange?: boolean;
}) {
  const accentBorder =
    accent === "krw"
      ? "border-l-4 border-l-admin-krw"
      : accent === "vnd"
        ? "border-l-4 border-l-admin-vnd"
        : "";

  const hasChange = changePct !== undefined && changePct !== null;
  const positive = hasChange && (invertChange ? changePct! < 0 : changePct! >= 0);
  const changeAbs = hasChange ? Math.abs(changePct!) : 0;

  return (
    <div
      className={`bg-admin-card p-4 rounded-xl border border-slate-700/50 ${accentBorder}`}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-xs font-medium text-admin-muted uppercase tracking-wider">
          {label}
        </span>
        {icon && (
          <span className={`material-symbols-outlined ${iconClassName ?? "text-admin-primary"}`}>
            {icon}
          </span>
        )}
      </div>
      {/* 큰 금액(VND 10자리+)이 좁은 모바일 카드를 넘치지 않도록 폰트 반응형 + 줄바꿈 허용(숫자 잘림 방지) */}
      <div className="flex items-baseline gap-1 min-w-0">
        <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums tracking-tight break-words min-w-0">
          {value}
        </span>
        {unit && <span className="text-sm text-admin-muted shrink-0">{unit}</span>}
      </div>
      {hasChange && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          <span
            className={`font-bold flex items-center ${positive ? "text-emerald-400" : "text-red-400"}`}
          >
            <span className="material-symbols-outlined text-sm">
              {positive ? "arrow_drop_up" : "arrow_drop_down"}
            </span>
            {changeAbs}
            {changeSuffix}
          </span>
          {changeFromLabel && <span className="text-slate-500">{changeFromLabel}</span>}
        </div>
      )}
      {footer && <div className="mt-1">{footer}</div>}
    </div>
  );
}
