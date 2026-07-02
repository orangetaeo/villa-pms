// /api/service-orders — 운영자 부가서비스 발주 전체 목록 (중계현황·공급자 정산 허브)
//   GET: canViewFinance 전용(정산·지급 경계, ADR-0013). 브로커된 발주(vendorId != null)만.
//   ★ costVnd = 공급자에게 지급할 금액. 판매가·마진 미포함. 데이터 로직은 lib/service-orders-hub 공유
//     (페이지 SSR 초기 렌더와 동일 shape). 이 라우트는 정산 후 클라 새로고침용.
import { NextResponse } from "next/server";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { getLocale } from "next-intl/server";
import { loadHubOrders } from "@/lib/service-orders-hub";

export async function GET(req: Request) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  // 운영자 표시 로케일(ko/vi) — 품목명·옵션 라벨 현지화. all-pages-vietnamese 대응.
  const locale = await getLocale();
  return NextResponse.json({ orders: await loadHubOrders(locale) });
}
