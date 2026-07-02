// /api/service-orders — 운영자 부가서비스 발주 목록 (중계현황·공급자 정산 허브)
//   GET: canViewFinance 전용(정산·지급 경계, ADR-0013). 서버 사이드 필터·페이지네이션(수천 건 대응).
//   쿼리: view(pending|paid|status)·status·range·itemId·vendorId·partnerId·villaId·guest·page·pageSize.
//   ★ costVnd(공급자 지급액)만. 판매가·마진 미포함. 로직은 lib/service-orders-hub 공유(페이지 SSR과 동일).
import { NextResponse } from "next/server";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { getLocale } from "next-intl/server";
import { parsePageParams } from "@/lib/pagination";
import { queryHub, type HubView, type HubStatusChip } from "@/lib/service-orders-hub";

const VIEWS: HubView[] = ["pending", "paid", "status"];
const CHIPS: HubStatusChip[] = ["all", "pending", "accepted", "rejected", "cancelled"];

export async function GET(req: Request) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  const locale = await getLocale();

  const url = new URL(req.url);
  const sp = url.searchParams;
  const viewRaw = sp.get("view") ?? "pending";
  const view: HubView = VIEWS.includes(viewRaw as HubView) ? (viewRaw as HubView) : "pending";
  const statusRaw = sp.get("status") ?? "all";
  const status: HubStatusChip = CHIPS.includes(statusRaw as HubStatusChip)
    ? (statusRaw as HubStatusChip)
    : "all";
  const { page, pageSize } = parsePageParams({
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });

  const result = await queryHub(
    {
      view,
      status,
      range: sp.get("range") ?? undefined,
      itemId: sp.get("itemId") ?? undefined,
      vendorId: sp.get("vendorId") ?? undefined,
      partnerId: sp.get("partnerId") ?? undefined,
      villaId: sp.get("villaId") ?? undefined,
      guest: sp.get("guest") ?? undefined,
      page,
      pageSize,
    },
    locale
  );

  return NextResponse.json(result);
}
