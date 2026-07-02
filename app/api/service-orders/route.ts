// /api/service-orders — 운영자 부가서비스 발주 전체 목록 (중계현황·공급자 정산 허브)
//   GET: canViewFinance 전용(정산·지급 경계, ADR-0013). 브로커된 발주(vendorId != null)만.
//   ★ costVnd = 공급자에게 지급할 금액(=공급자 매출). 우리 판매가(priceKrw/priceVnd)·마진은 미포함.
//     예약 상세를 하나씩 열지 않고 한 화면에서 중계현황 확인 + 공급자별 입금 처리하기 위한 목록.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { getLocale } from "next-intl/server";
import { pickI18n, selectedOptionLabels } from "@/lib/service-display";
import { formatVillaName } from "@/lib/villa-name";

export async function GET(req: Request) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  // 운영자 표시 로케일(ko/vi) — 품목명·옵션 라벨 현지화. all-pages-vietnamese 대응.
  const locale = await getLocale();

  const orders = await prisma.serviceOrder.findMany({
    where: { vendorId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      bookingId: true,
      type: true,
      status: true,
      vendorStatus: true,
      serviceDate: true,
      serviceTime: true,
      quantity: true,
      costVnd: true,
      vendorSettledAt: true,
      vendorSettleMethod: true,
      vendorSettleNote: true,
      poSentAt: true,
      vendorRespondedAt: true,
      createdAt: true,
      catalogItemId: true,
      vendorName: true,
      selectedOptions: true,
      vendorId: true,
      // ★ 정산 계좌(bankInfo)는 canViewFinance 전용 — 이 라우트는 게이트 통과했으므로 노출 가능.
      vendor: { select: { id: true, name: true, nameKo: true, phone: true, bankInfo: true } },
      booking: {
        select: {
          checkIn: true,
          checkOut: true,
          guestCount: true,
          // 고객명(텍스트 검색용) + 파트너명(셀렉터). partner 우선, 없으면 agencyName 폴백(ADR-0022).
          guestName: true,
          agencyName: true,
          partner: { select: { name: true } },
          villa: { select: { name: true, nameVi: true } },
        },
      },
    },
  });

  // 카탈로그 항목명 — catalogItemId는 관계 미정의 스칼라라 일괄 조회 후 매핑(vendor/orders와 동일 패턴).
  const itemIds = Array.from(
    new Set(orders.map((o) => o.catalogItemId).filter((v): v is string => !!v))
  );
  const items = itemIds.length
    ? await prisma.serviceCatalogItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, nameKo: true, nameI18n: true },
      })
    : [];
  const nameById = new Map(items.map((i) => [i.id, pickI18n(i.nameKo, i.nameI18n, locale)]));

  const data = orders.map((o) => ({
    id: o.id,
    bookingId: o.bookingId,
    villaName: o.booking?.villa
      ? formatVillaName({ name: o.booking.villa.name, nameVi: o.booking.villa.nameVi })
      : null,
    checkIn: o.booking?.checkIn ?? null,
    checkOut: o.booking?.checkOut ?? null,
    serviceDate: o.serviceDate,
    serviceTime: o.serviceTime,
    itemName: (o.catalogItemId ? nameById.get(o.catalogItemId) : null) ?? o.vendorName ?? null,
    optionLabel: selectedOptionLabels(o.selectedOptions, locale).join(" · ") || null,
    type: o.type,
    quantity: o.quantity,
    guestCount: o.booking?.guestCount ?? null,
    // 고객명·파트너명 — 필터용. 파트너 미지정이면 agencyName(텍스트 폴백).
    guestName: o.booking?.guestName ?? null,
    partnerName: o.booking?.partner?.name ?? o.booking?.agencyName ?? null,
    vendorId: o.vendorId,
    vendorName: o.vendor?.nameKo || o.vendor?.name || o.vendorName || null,
    vendorPhone: o.vendor?.phone ?? null,
    // 정산 계좌(은행·계좌·예금주) — canViewFinance 전용. 공급자별 입금 처리 시 참조.
    vendorBankInfo: o.vendor?.bankInfo ?? null,
    vendorStatus: o.vendorStatus,
    status: o.status,
    costVnd: o.costVnd.toString(),
    vendorSettledAt: o.vendorSettledAt,
    vendorSettleMethod: o.vendorSettleMethod,
    vendorSettleNote: o.vendorSettleNote,
    poSentAt: o.poSentAt,
    vendorRespondedAt: o.vendorRespondedAt,
    createdAt: o.createdAt,
  }));

  return NextResponse.json({ orders: data });
}
