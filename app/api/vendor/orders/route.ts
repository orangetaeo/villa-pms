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
import { formatVillaName } from "@/lib/villa-name";

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
      // 정산 투명성 — 정산 완료 건의 수단·메모를 공급자에게 그대로 표시(자기 지급 내역).
      vendorSettleMethod: true,
      vendorSettleNote: true,
      // 상태 타임라인 — 발주 발송·응답 시각. CANCELLED-발주됨 필터링에도 poSentAt 사용.
      poSentAt: true,
      vendorRespondedAt: true,
      createdAt: true,
      catalogItemId: true,
      vendorName: true,
      // 게스트 요청사항 — 이행에 필요한 정보(누수 아님: 가격·마진 없음).
      guestNote: true,
      // ★ 어떤 코스(variant)인지 — 가격은 selectedOptionLabels가 제거(공급자 누수 방지).
      selectedOptions: true,
      booking: {
        select: {
          checkIn: true,
          checkOut: true,
          guestCount: true,
          villa: { select: { name: true, nameVi: true } },
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

  // ★ 출력 대상: 활성 발주 전부 + 취소됐지만 "이미 발주됐던"(poSentAt != null) 건.
  //   취소 사실을 공급자에게 인앱으로 알려야 하므로 CANCELLED-발주됨은 포함(클라가 '취소됨' 배지로 표시).
  //   발주된 적 없는 취소 건(poSentAt == null)은 공급자가 본 적 없으니 노출하지 않는다.
  const visible = orders.filter(
    (o) => o.status !== "CANCELLED" || o.poSentAt != null
  );

  const data = visible
    .slice()
    .sort((a, b) => {
      const k = sortKey(a.vendorStatus) - sortKey(b.vendorStatus);
      if (k !== 0) return k;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .map((o) => ({
      id: o.id,
      villaName: o.booking?.villa
        ? formatVillaName({ name: o.booking.villa.name, nameVi: o.booking.villa.nameVi })
        : null,
      checkIn: o.booking?.checkIn ?? null,
      checkOut: o.booking?.checkOut ?? null,
      serviceDate: o.serviceDate,
      serviceTime: o.serviceTime,
      itemName: (o.catalogItemId ? itemNameById.get(o.catalogItemId) : null) ?? o.vendorName ?? null,
      // 선택 코스/옵션 라벨(가격 제거·현지화) — "오일 마사지 90분" 등. 없으면 null.
      optionLabel: selectedOptionLabels(o.selectedOptions, locale).join(" · ") || null,
      type: o.type,
      quantity: o.quantity,
      // 정원(투숙 인원) — booking.select에 있으나 매핑 누락이었음(dead select 복구).
      guestCount: o.booking?.guestCount ?? null,
      // 게스트 요청사항(이행 정보). 없으면 null.
      guestNote: o.guestNote,
      vendorStatus: o.vendorStatus,
      status: o.status,
      // ★ 공급자에게 지급할 금액(=그의 매출). 우리 판매가·마진 아님.
      costVnd: o.costVnd.toString(),
      vendorSettledAt: o.vendorSettledAt,
      // 정산 투명성 — 정산 완료 건 수단/메모(자기 지급 내역).
      vendorSettleMethod: o.vendorSettleMethod,
      vendorSettleNote: o.vendorSettleNote,
      // 상태 타임라인 — 발송·응답 시각(예약현황 카드 작은 글씨).
      poSentAt: o.poSentAt,
      vendorRespondedAt: o.vendorRespondedAt,
    }));

  return NextResponse.json({ orders: data });
}
