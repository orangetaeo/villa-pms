// /api/vendor/orders — 원천 공급자 본인 발주 목록 (ADR-0023 S2 §4.3)
//   GET: Role=VENDOR + 본인 vendorId 스코프 강제(서버). 자기 발주만.
//   ★ 누수: 우리 판매가(priceKrw/priceVnd)·마진 절대 미포함.
//      공급자는 costVnd(=우리가 그에게 지급할 금액=그의 매출)만 본다.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isVendor, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";
import { getSupplierLocale } from "@/lib/locale";
import { pickI18n, selectedOptionLabels } from "@/lib/service-display";

// PENDING_VENDOR(응답 대기)를 맨 위로, 그 외는 createdAt desc.
function sortKey(vendorStatus: string | null): number {
  return vendorStatus === "PENDING_VENDOR" ? 0 : 1;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const vendorId = await getVendorIdForUser(session.user.id);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

  // 공급자 표시 로케일(pref-locale 쿠키 > 계정 기본 > vi) — 품목명·옵션 라벨 현지화.
  const locale = await getSupplierLocale(session.user.locale);

  const orders = await prisma.serviceOrder.findMany({
    where: { vendorId },
    select: {
      id: true,
      type: true,
      status: true,
      vendorStatus: true,
      serviceDate: true,
      serviceTime: true,
      quantity: true,
      costVnd: true,
      vendorSettledAt: true,
      createdAt: true,
      catalogItemId: true,
      vendorName: true,
      // ★ 어떤 코스(variant)인지 — 가격은 selectedOptionLabels가 제거(공급자 누수 방지).
      selectedOptions: true,
      booking: {
        select: {
          checkIn: true,
          checkOut: true,
          guestCount: true,
          villa: { select: { name: true } },
        },
      },
    },
  });

  // 카탈로그 항목명 — ServiceOrder.catalogItemId는 관계 미정의 스칼라이므로 일괄 조회 후 매핑.
  const itemIds = Array.from(
    new Set(orders.map((o) => o.catalogItemId).filter((v): v is string => !!v))
  );
  const items = itemIds.length
    ? await prisma.serviceCatalogItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, nameKo: true, nameI18n: true },
      })
    : [];
  const itemNameById = new Map(
    items.map((i) => [i.id, pickI18n(i.nameKo, i.nameI18n, locale)])
  );

  const data = orders
    .slice()
    .sort((a, b) => {
      const k = sortKey(a.vendorStatus) - sortKey(b.vendorStatus);
      if (k !== 0) return k;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .map((o) => ({
      id: o.id,
      villaName: o.booking?.villa?.name ?? null,
      checkIn: o.booking?.checkIn ?? null,
      checkOut: o.booking?.checkOut ?? null,
      serviceDate: o.serviceDate,
      serviceTime: o.serviceTime,
      itemName: (o.catalogItemId ? itemNameById.get(o.catalogItemId) : null) ?? o.vendorName ?? null,
      // 선택 코스/옵션 라벨(가격 제거·현지화) — "오일 마사지 90분" 등. 없으면 null.
      optionLabel: selectedOptionLabels(o.selectedOptions, locale).join(" · ") || null,
      type: o.type,
      quantity: o.quantity,
      vendorStatus: o.vendorStatus,
      status: o.status,
      // ★ 공급자에게 지급할 금액(=그의 매출). 우리 판매가·마진 아님.
      costVnd: o.costVnd.toString(),
      vendorSettledAt: o.vendorSettledAt,
    }));

  return NextResponse.json({ orders: data });
}
