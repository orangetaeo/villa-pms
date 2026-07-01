// /service-orders — 운영자 부가서비스 정산·중계 허브 (ADR-0023)
//   예약 상세를 하나씩 열지 않고 한 화면에서 ① 부가서비스 중계현황 확인 ② 공급자별 입금(정산) 처리.
//   재무 경계(canViewFinance) — costVnd(공급자 지급액)를 다루므로 STAFF 차단. layout과 이중 가드.
//   목록·정산 액션은 클라이언트에서 /api/service-orders, /api/service-orders/settle-batch 소비.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canViewFinance } from "@/lib/permissions";
import ServiceOrdersView from "./service-orders-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("serviceOrders")} — Villa Go` };
}

export default async function ServiceOrdersPage() {
  // 재무 권한자(OWNER/MANAGER) 가드 — 부가서비스 정산=지급 경계(ADR-0013). STAFF 차단.
  const session = await auth();
  if (!session || !canViewFinance(session.user?.role)) redirect("/login");

  return <ServiceOrdersView />;
}
