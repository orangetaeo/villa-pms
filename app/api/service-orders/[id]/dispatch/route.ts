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
import { enqueueNotification } from "@/lib/zalo";
import { enqueueInAppNotification, buildVendorNotifText } from "@/lib/inapp-notification";
import { NotificationType } from "@prisma/client";
import { toDateOnlyString } from "@/lib/date-vn";

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
      quantity: true,
      catalogItemId: true,
      vendorName: true,
      guestNote: true, // 게스트 요청사항 — 발주 본문에 전달(판매가·마진과 무관, 노출 OK)
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
  await prisma.serviceOrder.update({
    where: { id },
    data: {
      vendorStatus: "PENDING_VENDOR",
      poSentAt: now,
      vendorRespondedAt: null,
      vendorRejectReason: null,
    },
  });

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
        guestNote: order.guestNote ?? null, // 게스트 요청사항(있으면 발주 문구에 한 줄 추가)
      },
    });
    zaloSent = true;
  } else {
    warning = "NO_VENDOR_ZALO";
  }

  // 인앱 알림센터 적재(Zalo와 별개 — 미연결 공급자도 앱에서 발주를 인지해야 함).
  //   ★ 누수: 가격·마진 없음(품목·수량·빌라만). try/catch 격리로 본 발주 로직 영향 0.
  if (order.vendor?.userId) {
    try {
      const { title, body } = buildVendorNotifText(NotificationType.VENDOR_PO, {
        itemName,
        quantity: order.quantity,
        villaName: order.booking?.villa?.name ?? null,
        serviceDate: order.serviceDate ? toDateOnlyString(order.serviceDate) : null,
      });
      await enqueueInAppNotification({
        userId: order.vendor.userId,
        type: NotificationType.VENDOR_PO,
        title,
        body,
        href: "/vendor",
      });
    } catch {
      // 인앱 알림 적재 실패는 발주 성공을 막지 않는다(폴링 다음 주기엔 미반영일 뿐).
    }
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
