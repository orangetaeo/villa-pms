// /service-orders — 운영자 부가서비스 정산·중계 허브 (ADR-0023)
//   예약 상세를 하나씩 열지 않고 한 화면에서 ① 부가서비스 중계현황 확인 ② 공급자별 입금(정산) 처리.
//   재무 경계(canViewFinance) — costVnd(공급자 지급액)를 다루므로 STAFF 차단. layout과 이중 가드.
//   ★성능: 초기 목록을 서버(RSC)에서 미리 로드해 클라에 주입 → 마운트 후 fetch 워터폴 제거(첫 화면 즉시).
//     정산 후 최신화는 클라가 /api/service-orders(동일 loader)로 새로고침.
import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canViewFinance } from "@/lib/permissions";
import { loadHubOrders } from "@/lib/service-orders-hub";
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
  const initialOrders = await loadHubOrders(locale);

  return <ServiceOrdersView initialOrders={initialOrders} />;
}
