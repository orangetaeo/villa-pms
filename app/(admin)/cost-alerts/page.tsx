// /cost-alerts — 견적 중 원가 변경 경보 (b15 변환, F) — 운영자(ADMIN) 전용
// RSC: (admin) 레이아웃 role 가드 아래에서만 렌더. 마진·판매가·KRW 노출은 운영자 화면에서만 정당.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadCostAlerts } from "@/lib/cost-alerts";
import { quickRangeWhere } from "@/lib/date-vn";
import QuickDateFilter from "@/components/admin/quick-date-filter";
import CostAlertsView from "./cost-alerts-view";

export const metadata: Metadata = { title: "견적 중 원가 변경 — Villa PMS" };

// 과거 전용 경보 → nextMonth 제외
const COST_ALERT_PRESETS = [
  "all",
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "lastMonth",
] as const;

export default async function CostAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const [session, t] = await Promise.all([
    auth(),
    getTranslations("adminCostAlerts"),
  ]);
  // 레이아웃 가드로 ADMIN 보장 — 방어적으로 한 번 더
  const adminId = session?.user?.id;
  const allGroups = adminId ? await loadCostAlerts(prisma, adminId) : [];

  // 빠른 날짜 필터 — detectedAt 기준 [gte, lt). undefined=전체
  const window = quickRangeWhere(range, "timestamp");
  const groups = window
    ? allGroups.filter((g) => {
        const at = new Date(g.detectedAt);
        return at >= window.gte && at < window.lt;
      })
    : allGroups;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">{t("pageTitle")}</h1>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
      </div>
      {/* 빠른 날짜 필터 바 (다크 톤, 목록 상단) */}
      <QuickDateFilter presets={[...COST_ALERT_PRESETS]} />
      <CostAlertsView groups={groups} />
    </div>
  );
}
