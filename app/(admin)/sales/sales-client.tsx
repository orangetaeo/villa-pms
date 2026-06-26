"use client";

// 매출관리 클라이언트 — 매출 전용 단일 스크롤(탭 없음). 정산(/settlements)과 별개(IDEAS 2026-06-24).
// ★ 매출 뷰는 /statistics 개요·빌라 탭과 동일 집계를 재사용한다(중복 구현 금지):
//   OverviewTab(매출 KPI·추이·채널) + VillasTab(빌라별 매출 랭킹, hasFinance=true 고정).
// ★ 재무 전용 — page.tsx에서 canViewFinance 게이트를 끝내고(STAFF는 라우트 자체 차단),
//   여기로는 항상 재무 데이터만 내려온다(누수 가드 보조: 받은 것만 렌더).

import { useTranslations } from "next-intl";
import type { OverviewStats, VillaPerformanceRow } from "@/lib/statistics";
import DateRangeFilter from "@/components/admin/statistics/date-range-filter";
import {
  OverviewTab,
  VillasTab,
  type StatsPeriodMeta,
} from "../statistics/statistics-client";

export interface SalesProps {
  period: StatsPeriodMeta;
  overview: OverviewStats;
  villas: VillaPerformanceRow[];
}

export default function SalesClient({ period, overview, villas }: SalesProps) {
  const t = useTranslations("adminSales");

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-lg font-bold text-white">{t("title")}</h1>
        <span className="text-slate-600">/</span>
        <span className="text-sm text-admin-muted">{t("subtitle")}</span>
      </div>

      {/* 기간 필터 — /statistics와 동일(프리셋 칩 + 커스텀 from/to, URL 동기화) */}
      <div className="flex justify-end border-b border-slate-800 mt-4 pb-2">
        <DateRangeFilter
          presetKey={period.presetKey}
          fromText={period.fromText}
          toText={period.toText}
        />
      </div>

      {/* 매출 KPI·추이·채널 (개요 집계 재사용) */}
      <div className="py-6 space-y-6">
        <OverviewTab data={overview} />

        {/* 빌라별 매출 랭킹 */}
        <section className="space-y-4 pt-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-bold text-white">{t("villaSection.title")}</h2>
            <p className="text-[11px] text-slate-500">{t("villaSection.subtitle")}</p>
          </div>
          <VillasTab rows={villas} hasFinance />
        </section>
      </div>
    </div>
  );
}
