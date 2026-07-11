// /api/service-orders/[id]/dispatch — 원천 공급자에게 발주(PO) 발송 (ADR-0023 S2 §4.3)
//   POST: 운영자가 vendorId 지정된 REQUESTED 주문을 발주 → vendorStatus=PENDING_VENDOR + Zalo 발송.
//   거절 후 재발주 허용(canDispatch). 공급자 Zalo 미연결이면 발주는 기록하되 zaloSent:false 경보.
//   ★ 누수: Zalo 본문에 판매가·마진 미포함(buildNotificationText VENDOR_PO 화이트리스트).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { canDispatch } from "@/lib/vendor-order";
import { sendVendorPoNotifications } from "@/lib/vendor-dispatch";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const actorId = session.user.id;
  const { id } = await params;

  const order = await prisma.serviceOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      vendorId: true,
      vendorStatus: true,
      serviceDate: true,
      serviceTime: true, // 이행 시각 — 발주 문구에 날짜와 병기
      quantity: true,
      costVnd: true, // 벤더 자기 정산액(라인 총액) — 벤더 정당 정보(판매가·마진 아님)
      selectedOptions: true, // 옵션 스냅샷 — 라벨만 추출해 전달(가격 제거)
      catalogItemId: true,
      vendorName: true,
      guestNote: true, // 게스트 요청사항 — 발주 본문에 전달(판매가·마진과 무관, 노출 OK)
      customerName: true, // ★이용자 이름 스냅샷 — 없으면 예약 대표자(guestName) 폴백
      vendor: {
        select: {
          id: true,
          name: true,
          userId: true,
          approvalStatus: true,
          user: { select: { zaloUserId: true, locale: true } },
        },
      },
      booking: { select: { guestName: true, villa: { select: { name: true, address: true } } } },
    },
  });
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // 카탈로그 항목명(ServiceOrder.catalogItemId는 스칼라 — 관계 미정의이므로 별도 조회)
  const item = order.catalogItemId
    ? await prisma.serviceCatalogItem.findUnique({
        where: { id: order.catalogItemId },
        select: { nameKo: true },
      })
    : null;
  const itemName = item?.nameKo ?? order.vendorName ?? "—";
  if (!order.vendorId) return NextResponse.json({ error: "NO_VENDOR" }, { status: 400 });
  // 승인 게이트 — 미승인 공급자(자가가입 대기·거절)에는 발주 불가 (ADR-0023 S5)
  if (order.vendor?.approvalStatus !== "APPROVED") {
    return NextResponse.json({ error: "VENDOR_NOT_APPROVED" }, { status: 409 });
  }
  if (!canDispatch(order)) {
    return NextResponse.json(
      { error: "CANNOT_DISPATCH", status: order.status, vendorStatus: order.vendorStatus },
      { status: 409 }
    );
  }

  const now = new Date();
  // ★동시성 가드 — 읽은 상태(status·vendorStatus) 위에서만 발주 반영. 동시 이중 발주 시
  //   count===0 → 409로 차단해 이중 PO Zalo 알림을 막는다(canDispatch는 읽기 스냅샷 기준이라
  //   DB 레벨 재확인이 없으면 두 요청이 모두 통과). 가드 통과 후에만 enqueue.
  const dispatched = await prisma.serviceOrder.updateMany({
    where: { id, status: order.status, vendorStatus: order.vendorStatus },
    data: {
      vendorStatus: "PENDING_VENDOR",
      poSentAt: now,
      vendorRespondedAt: null,
      vendorRejectReason: null,
    },
  });
  if (dispatched.count === 0) {
    return NextResponse.json({ error: "CONCURRENT_MODIFICATION" }, { status: 409 });
  }

  // Zalo 발주(연결 시) + 인앱 적재 — 공용 헬퍼로 위임(게스트 자동 발주 경로와 동일 로직).
  const { zaloSent } = await sendVendorPoNotifications({
    vendor: order.vendor ?? null,
    villaName: order.booking?.villa?.name ?? null,
    villaAddress: order.booking?.villa?.address ?? null, // 이행 장소(발주 빌라 1채만)
    serviceDate: order.serviceDate,
    serviceTime: order.serviceTime,
    itemName,
    quantity: order.quantity,
    selectedOptions: order.selectedOptions,
    costVnd: order.costVnd,
    guestNote: order.guestNote,
    customerName: order.customerName ?? order.booking?.guestName ?? null, // ★이용자 이름(폴백)
  });
  // zaloUserId 미연결이면 경보 — 발주는 기록하되 Zalo는 못 감(운영자에게 표시).
  const warning: string | undefined = zaloSent ? undefined : "NO_VENDOR_ZALO";

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: {
      vendorStatus: { old: order.vendorStatus, new: "PENDING_VENDOR" },
      poSentAt: { new: now.toISOString() },
      zaloSent: { new: zaloSent },
    },
  });

  return NextResponse.json({
    id,
    dispatched: true,
    zaloSent,
    ...(warning ? { warning } : {}),
  });
}
