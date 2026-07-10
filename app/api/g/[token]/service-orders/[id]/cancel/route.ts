// POST /api/g/[token]/service-orders/[id]/cancel — 게스트 셀프 취소(A3 · ADR-0033 직접 발주)
//   비로그인(토큰). 게스트가 직접 신청한(requestedVia=GUEST) REQUESTED 주문만 취소 가능.
//   운영자 확정(CONFIRMED) 이후·타예약 주문·타경로 주문은 차단(404/409). 결제 없음.
//   동시성: where에 status="REQUESTED" 포함 + updateMany count=0이면 409(이미 확정/취소).
//   ★취소 가드(ADR-0033): 자동 발주로 게스트 주문은 대부분 PENDING_VENDOR지만, 벤더가 아직 수락하지
//     않은 상태(null·VENDOR_REJECTED·PENDING_VENDOR)면 셀프 취소 허용. 벤더 수락(VENDOR_ACCEPTED=
//     자동 확정 직전/CONFIRMED)만 차단. PENDING_VENDOR였던 주문 취소 시 벤더에게 발주취소 통보 발송.
//     취소와 벤더 수락의 레이스는 updateMany(where에 PENDING_VENDOR 포함)로 DB가 원자 판정.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { guestTokenState } from "@/lib/guest-checkin";
import { guestRateLimit } from "@/lib/guest-rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import { sendVendorPoCancelledNotifications } from "@/lib/vendor-dispatch";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  // 비인증 게스트 mutation 폭주 방어 (보안 P0-3)
  const rl = await guestRateLimit("g-service-order-cancel", token, req);
  if (rl) return rl;
  const csrf = await assertSameOrigin(req, "g-service-order-cancel");
  if (csrf) return csrf;

  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { bookingId: true, expiresAt: true, revokedAt: true },
  });
  if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (guestTokenState(t, new Date()) !== "OK") {
    return NextResponse.json({ error: "TOKEN_UNAVAILABLE" }, { status: 410 });
  }

  // 교차검증 — 이 주문이 토큰의 예약 소속 + 게스트 신청 + REQUESTED 상태인지.
  //   타예약·타경로(운영자 입력)·존재하지 않는 id는 404(id 추측 방지).
  //   벤더 관계 select — PENDING_VENDOR 취소 시 발주취소 통보용(★ bankInfo·costVnd 미포함, 누수 0).
  const order = await prisma.serviceOrder.findFirst({
    where: { id, bookingId: t.bookingId, requestedVia: "GUEST" },
    select: {
      id: true,
      status: true,
      vendorStatus: true,
      poSentAt: true,
      quantity: true,
      serviceDate: true,
      catalogItemId: true,
      vendorName: true,
      vendor: { select: { userId: true, user: { select: { zaloUserId: true, locale: true } } } },
      booking: { select: { villa: { select: { name: true } } } },
    },
  });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });

  // ★취소 가드 — 벤더가 수락한(VENDOR_ACCEPTED) 발주만 셀프 취소 불가(운영자 조율 필요).
  //   미발주(null)·거절(VENDOR_REJECTED)·발주대기(PENDING_VENDOR, 벤더 미수락)는 셀프 취소 허용.
  //   409 코드는 하위호환 위해 "DISPATCHED" 유지하되 의미는 "벤더 수락됨".
  if (order.vendorStatus === "VENDOR_ACCEPTED") {
    return NextResponse.json({ error: "DISPATCHED" }, { status: 409 });
  }

  // 동시성 가드 — status가 그 사이 CONFIRMED/CANCELLED로 바뀌거나 벤더가 수락하면 count=0 → 409.
  //   where의 OR에 PENDING_VENDOR 포함 → 취소와 벤더 수락(자동 확정) 레이스를 DB가 원자 판정.
  const res = await prisma.serviceOrder.updateMany({
    where: {
      id,
      bookingId: t.bookingId,
      requestedVia: "GUEST",
      status: "REQUESTED",
      OR: [
        { vendorStatus: null },
        { vendorStatus: "VENDOR_REJECTED" },
        { vendorStatus: "PENDING_VENDOR" },
      ],
    },
    data: { status: "CANCELLED" },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "NOT_CANCELLABLE" }, { status: 409 });
  }

  // ★PENDING_VENDOR였던 주문 취소 성공 → 벤더에게 발주취소 통보(stale PO 방지). Zalo(연결 시) + 인앱.
  let vendorNotified = false;
  if (order.vendorStatus === "PENDING_VENDOR") {
    // 카탈로그 항목명(벤더 vi 통지용) — catalogItemId는 관계 미정의 스칼라라 별도 조회.
    const item = order.catalogItemId
      ? await prisma.serviceCatalogItem.findUnique({
          where: { id: order.catalogItemId },
          select: { nameKo: true },
        })
      : null;
    const itemName = item?.nameKo ?? order.vendorName ?? "—";
    const { zaloSent } = await sendVendorPoCancelledNotifications({
      vendor: order.vendor ?? null,
      itemName,
      quantity: order.quantity,
      villaName: order.booking?.villa?.name ?? null,
      serviceDate: order.serviceDate,
    });
    vendorNotified = zaloSent;
  }

  await writeAuditLog({
    db: prisma,
    userId: null,
    action: "UPDATE",
    entity: "ServiceOrder",
    entityId: id,
    changes: {
      status: { old: "REQUESTED", new: "CANCELLED" },
      via: { new: "GUEST_SERVICE_ORDER_CANCEL" },
      ...(vendorNotified ? { vendorPoCancelNotified: { new: true } } : {}),
    },
  });

  return NextResponse.json(
    { id, status: "CANCELLED", ...(vendorNotified ? { vendorNotified: true } : {}) },
    { status: 200 }
  );
}
