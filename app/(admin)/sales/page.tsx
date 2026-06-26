// /sales — 매출관리 페이지 (IDEAS 2026-06-24, 정산과 별개). Stitch 신규 없이 /statistics 디자인 언어 계승.
// RSC: auth + isOperator 가드(없으면 /login). 매출=재무 전용 → canViewFinance(role) 아니면 /dashboard로.
//   (미들웨어 FINANCE_PATHS에도 /sales 등록 — 이중 차단. STAFF는 매출·마진 노출 0.)
// ★ 집계 중복 구현 금지: loadOverviewStats(매출 KPI·추이·채널) + loadVillaPerformance(빌라별 매출)를
//   /statistics와 동일하게 재사용한다. 마진 환산·통화 분리(ADR-0003)는 그 단일 소스가 책임.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canViewFinance, isOperator } from "@/lib/permissions";
import {
  resolveStatsPeriod,
  loadDataFloor,
  loadOverviewStats,
  loadVillaPerformance,
} from "@/lib/statistics";
import SalesClient from "./sales-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("sales")} — Villa Go` };
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  // 운영자 가드 — layout·middleware와 이중화(방어적).
  const session = await auth();
  if (!session?.user?.id || !isOperator(session.user.role)) redirect("/login");
  // 매출 전체가 재무 데이터 → 재무 권한 없으면 페이지 자체 차단(누수 0).
  if (!canViewFinance(session.user.role)) redirect("/dashboard");

  const params = await searchParams;

  // 기간 단일 해석 — 'all'만 데이터 최소일(min checkOut) 필요(불필요 쿼리 회피).
  const dataFloor = params.range === "all" ? await loadDataFloor() : null;
  const period = resolveStatsPeriod(
    { range: params.range, from: params.from, to: params.to },
    new Date(),
    dataFloor
  );

  // 매출 집계 — /statistics 개요·빌라 로더 재사용(재무 전용 호출).
  const [overview, villas] = await Promise.all([
    loadOverviewStats(period),
    loadVillaPerformance(period, true),
  ]);

  const periodMeta = {
    fromText: period.fromText,
    toText: period.toText,
    granularity: period.granularity,
    presetKey: period.presetKey,
  };

  return <SalesClient period={periodMeta} overview={overview} villas={villas} />;
}
