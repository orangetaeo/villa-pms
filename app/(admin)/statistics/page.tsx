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
  resolveStatsPeriod,
  loadDataFloor,
  loadOverviewStats,
  loadOccupancyStats,
  loadVillaPerformance,
  loadFunnelStats,
  loadOperationsStats,
  loadMinibarStats,
  loadServiceOrderStats,
} from "@/lib/statistics";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";
import StatisticsClient, { type TabKey } from "./statistics-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("statistics")} — Villa Go` };
}

const TAB_KEYS: TabKey[] = ["overview", "occupancy", "villas", "operations", "ancillary"];

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string; from?: string; to?: string }>;
}) {
  // 운영자 가드 — layout과 이중화(방어적). 비운영자는 라우트 자체 차단.
  const session = await auth();
  if (!session?.user?.id || !isOperator(session.user.role)) redirect("/login");

  const fin = canViewFinance(session.user.role);
  const params = await searchParams;

  // 기간 단일 해석 — 'all'은 데이터 최소일(min checkOut) 필요 → 사전 조회.
  //   'all'이 아니면 dataFloor 불필요(불필요한 쿼리 회피).
  const dataFloor = params.range === "all" ? await loadDataFloor() : null;
  const period = resolveStatsPeriod(
    { range: params.range, from: params.from, to: params.to },
    new Date(),
    dataFloor
  );

  // 탭 결정 — 기본=fin?overview:occupancy. STAFF가 ?tab=overview로 와도 overview 차단.
  let activeTab: TabKey =
    params.tab && TAB_KEYS.includes(params.tab as TabKey)
      ? (params.tab as TabKey)
      : fin
        ? "overview"
        : "occupancy";
  // 개요·부가서비스/미니바(ancillary)는 매출=재무 전용 — STAFF가 ?tab으로 와도 차단(누수·빈탭 방지).
  if ((activeTab === "overview" || activeTab === "ancillary") && !fin) activeTab = "occupancy";

  // 데이터 로드 — 금액 게이트는 여기서 끝낸다(period 단일 주입).
  //  · overview·minibar: fin일 때만 (페이로드에 금액 자체 부재 — 매출=재무)
  //  · villas·operations: includeFinance=fin (false면 금액 키 없음)
  //  · occupancy·funnel: 항상
  const [overview, minibar, services, occupancy, villas, funnel, operations] =
    await Promise.all([
      fin ? loadOverviewStats(period) : Promise.resolve(undefined),
      fin ? loadMinibarStats(period) : Promise.resolve(undefined),
      fin ? loadServiceOrderStats(period) : Promise.resolve(undefined),
      loadOccupancyStats(period),
      loadVillaPerformance(period, fin),
      loadFunnelStats(period),
      loadOperationsStats(period, fin),
    ]);

  // client로 내려보낼 직렬화 가능 period(Date 제외 — 표시·URL 동기화용).
  const periodMeta = {
    fromText: period.fromText,
    toText: period.toText,
    granularity: period.granularity,
    presetKey: period.presetKey,
  };

  const tTour = await getTranslations("tour");

  return (
    <>
      <StatisticsClient
        fin={fin}
        activeTab={activeTab}
        period={periodMeta}
        overview={overview}
        minibar={minibar}
        services={services}
        occupancy={occupancy}
        villas={villas}
        funnel={funnel}
        operations={operations}
      />

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 "?"로 재생 (T-tutorial-onboarding-6) */}
      <CoachMark
        tourId="adminStatistics"
        steps={buildTourSteps(tTour, "adminStatistics")}
        labels={buildTourLabels(tTour)}
      />
    </>
  );
}
