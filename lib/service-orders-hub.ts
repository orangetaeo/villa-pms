// lib/service-orders-hub.ts — 부가서비스 정산·중계 허브 데이터 로더 (서버 전용).
//   /api/service-orders(클라 새로고침용)와 /service-orders 페이지(SSR 초기 렌더용)가 동일 shape를 공유.
//   날짜는 ISO 문자열로 직렬화 → JSON 응답과 RSC prop 직렬화 결과가 동일(클라 Order 타입=string).
//   ★ 누수 경계: costVnd(공급자 지급액)만. 판매가·마진 미포함(원칙2). 호출부가 canViewFinance 게이트 담당.
import { prisma } from "@/lib/prisma";
import { pickI18n, selectedOptionLabels } from "@/lib/service-display";
import { formatVillaName } from "@/lib/villa-name";

export type HubOrder = {
  id: string;
  bookingId: string;
  villaName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  serviceDate: string | null;
  serviceTime: string | null;
  itemName: string | null;
  optionLabel: string | null;
  type: string | null;
  quantity: number;
  guestCount: number | null;
  guestName: string | null;
  partnerName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorPhone: string | null;
  vendorBankInfo: unknown;
  vendorStatus: "PENDING_VENDOR" | "VENDOR_ACCEPTED" | "VENDOR_REJECTED" | null;
  status: string;
  costVnd: string;
  vendorSettledAt: string | null;
  vendorSettleMethod: "CASH" | "BANK_TRANSFER" | "OTHER" | null;
  vendorSettleNote: string | null;
  poSentAt: string | null;
  vendorRespondedAt: string | null;
  createdAt: string;
};

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** 브로커된 부가서비스 발주(vendorId != null) 전량을 표시용 shape로 로드. locale=품목·옵션 라벨 현지화. */
export async function loadHubOrders(locale: string): Promise<HubOrder[]> {
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
      // ★ 정산 계좌(bankInfo)는 canViewFinance 전용 — 호출부가 게이트 통과 후 사용.
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

  // 카탈로그 항목명 — catalogItemId는 관계 미정의 스칼라라 일괄 조회 후 매핑.
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

  return orders.map((o) => ({
    id: o.id,
    bookingId: o.bookingId,
    villaName: o.booking?.villa
      ? formatVillaName({ name: o.booking.villa.name, nameVi: o.booking.villa.nameVi })
      : null,
    checkIn: iso(o.booking?.checkIn),
    checkOut: iso(o.booking?.checkOut),
    serviceDate: iso(o.serviceDate),
    serviceTime: o.serviceTime,
    itemName: (o.catalogItemId ? nameById.get(o.catalogItemId) : null) ?? o.vendorName ?? null,
    optionLabel: selectedOptionLabels(o.selectedOptions, locale).join(" · ") || null,
    type: o.type,
    quantity: o.quantity,
    guestCount: o.booking?.guestCount ?? null,
    guestName: o.booking?.guestName ?? null,
    partnerName: o.booking?.partner?.name ?? o.booking?.agencyName ?? null,
    vendorId: o.vendorId,
    vendorName: o.vendor?.nameKo || o.vendor?.name || o.vendorName || null,
    vendorPhone: o.vendor?.phone ?? null,
    vendorBankInfo: o.vendor?.bankInfo ?? null,
    vendorStatus: o.vendorStatus,
    status: o.status,
    costVnd: o.costVnd.toString(),
    vendorSettledAt: iso(o.vendorSettledAt),
    vendorSettleMethod: o.vendorSettleMethod,
    vendorSettleNote: o.vendorSettleNote,
    poSentAt: iso(o.poSentAt),
    vendorRespondedAt: iso(o.vendorRespondedAt),
    createdAt: iso(o.createdAt) as string,
  }));
}
