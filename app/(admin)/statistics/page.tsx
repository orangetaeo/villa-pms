// /statistics — 운영자 통계화면 (T-admin-statistics, Stitch b17 변환)
// RSC: auth + isOperator 가드(없으면 /login). 재무 게이트는 canViewFinance(role)로 서버에서 판정.
// ★ 누수 차단(계약 §3/§7.1): fin=false면 loadOverviewStats를 아예 호출하지 않고(개요 데이터 부재),
//   loadVillaPerformance·loadOperationsStats는 includeFinance=fin → 금액 키 자체가 페이로드에 없음.
//   가동률·funnel은 항상(전 운영자). STAFF는 개요 탭 자체가 클라이언트에 렌더되지 않음.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canViewFinance, isOperator } from "@/lib/permissions";
import {
  parseStatsRange,
  loadOverviewStats,
  loadOccupancyStats,
  loadVillaPerformance,
  loadFunnelStats,
  loadOperationsStats,
} from "@/lib/statistics";
import StatisticsClient, { type TabKey } from "./statistics-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("statistics")} — Villa Go` };
}

const TAB_KEYS: TabKey[] = ["overview", "occupancy", "villas", "operations"];

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string }>;
}) {
  // 운영자 가드 — layout과 이중화(방어적). 비운영자는 라우트 자체 차단.
  const session = await auth();
  if (!session?.user?.id || !isOperator(session.user.role)) redirect("/login");

  const fin = canViewFinance(session.user.role);
  const params = await searchParams;
  const range = parseStatsRange(params.range);
  // URL로 내려보낼 정규화된 range 문자열 ("6"|"12"|"YYYY")
  const rangeStr = typeof range === "object" ? String(range.year) : range;

  // 탭 결정 — 기본=fin?overview:occupancy. STAFF가 ?tab=overview로 와도 overview 차단.
  let activeTab: TabKey =
    params.tab && TAB_KEYS.includes(params.tab as TabKey)
      ? (params.tab as TabKey)
      : fin
        ? "overview"
        : "occupancy";
  if (activeTab === "overview" && !fin) activeTab = "occupancy";

  // 데이터 로드 — 금액 게이트는 여기서 끝낸다.
  //  · overview: fin일 때만 (페이로드에 금액 자체 부재)
  //  · villas·operations: includeFinance=fin (false면 금액 키 없음)
  //  · occupancy·funnel: 항상
  const [overview, occupancy, villas, funnel, operations] = await Promise.all([
    fin ? loadOverviewStats(range) : Promise.resolve(undefined),
    loadOccupancyStats(range),
    loadVillaPerformance(range, fin),
    loadFunnelStats(range),
    loadOperationsStats(range, fin),
  ]);

  return (
    <StatisticsClient
      fin={fin}
      activeTab={activeTab}
      range={rangeStr}
      overview={overview}
      occupancy={occupancy}
      villas={villas}
      funnel={funnel}
      operations={operations}
    />
  );
}
