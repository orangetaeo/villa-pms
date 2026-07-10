// /service-orders — 운영자 부가서비스 정산·중계 허브 (ADR-0023)
//   한 화면에서 ① 부가서비스 중계현황 확인 ② 공급자별 입금(정산) 처리.
//   재무 경계(canViewFinance) — costVnd(공급자 지급액)를 다루므로 STAFF 차단. layout과 이중 가드.
//   ★성능: 발주가 수천 건이라 서버 사이드 필터·페이지네이션. SSR은 기본 뷰(입금 대기) 1페이지 +
//     셀렉터 옵션만 로드 → 첫 화면 즉시. 이후 뷰/필터/페이지 변경은 /api/service-orders로 페이지 단위 조회.
import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canViewFinance } from "@/lib/permissions";
import { queryHub, loadHubOptions } from "@/lib/service-orders-hub";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";
import ServiceOrdersView from "./service-orders-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("serviceOrders")} — Villa Go` };
}

export default async function ServiceOrdersPage() {
  // 재무 권한자(OWNER/MANAGER) 가드 — 부가서비스 정산=지급 경계(ADR-0013). STAFF 차단.
  const session = await auth();
  if (!session || !canViewFinance(session.user?.role)) redirect("/login");

  const locale = await getLocale();
  const tTour = await getTranslations("tour");
  // 기본 뷰(입금 대기) 1페이지 + 셀렉터 옵션을 서버에서 미리 로드.
  const [initial, options] = await Promise.all([
    queryHub({ view: "pending", page: 1, pageSize: DEFAULT_PAGE_SIZE }, locale),
    loadHubOptions(locale),
  ]);

  return (
    <>
      <ServiceOrdersView
        initial={initial}
        options={options}
        pageSize={DEFAULT_PAGE_SIZE}
      />

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 "?"로 재생 (T-tutorial-onboarding-6) */}
      <CoachMark
        tourId="adminServiceOrders"
        steps={buildTourSteps(tTour, "adminServiceOrders")}
        labels={buildTourLabels(tTour)}
      />
    </>
  );
}
