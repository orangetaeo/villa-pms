// /api/service-orders/[id]/dispatch — 원천 공급자에게 발주(PO) 발송 (ADR-0023 S2 §4.3)
//   POST: 운영자가 vendorId 지정된 REQUESTED 주문을 발주 → vendorStatus=PENDING_VENDOR + Zalo 발송.
//   거절 후 재발주 허용(canDispatch). 공급자 Zalo 미연결이면 발주는 기록하되 zaloSent:false 경보.
//   ★ 누수: Zalo 본문에 판매가·마진 미포함(buildNotificationText VENDOR_PO 화이트리스트).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, type Role } from "@/lib/permissions";
import { canDispatch } from "@/lib/vendor-order";
import { enqueueNotification } from "@/lib/zalo";
import { NotificationType } from "@prisma/client";
import { toDateOnlyString } from "@/lib/date-vn";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const role = session.user.role as Role | undefined;
  if (!isOperator(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
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
      quantity: true,
      catalogItemId: true,
      vendorName: true,
      vendor: {
        select: {
          id: true,
          name: true,
          userId: true,
          approvalStatus: true,
          user: { select: { zaloUserId: true } },
        },
      },
      booking: { select: { villa: { select: { name: true } } } },
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
  // 동시성 가드 — 읽은 상태(status·vendorStatus) 위에서만 발주 반영. 동시 이중 발주 시
  // count===0 → 409로 차단해 이중 PO Zalo 알림을 막는다(canDispatch는 읽기 스냅샷 기준이라
  // DB 레벨 재확인이 없으면 두 요청이 모두 통과).
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

  // Zalo 발주 — 공급자 User에 zaloUserId 연결돼 있을 때만 큐 적재(발송은 cron).
  const vendorZalo = order.vendor?.user?.zaloUserId;
  let zaloSent = false;
  let warning: string | undefined;
  if (order.vendor?.userId && vendorZalo) {
    await enqueueNotification({
      userId: order.vendor.userId,
      type: NotificationType.VENDOR_PO,
      payload: {
        villaName: order.booking?.villa?.name ?? "—",
        serviceDate: order.serviceDate ? toDateOnlyString(order.serviceDate) : null,
        itemName,
        quantity: order.quantity,
      },
    });
    zaloSent = true;
  } else {
    warning = "NO_VENDOR_ZALO";
  }

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
