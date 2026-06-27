// POST /api/g/[token]/service-orders/[id]/cancel — 게스트 셀프 취소(A3)
//   비로그인(토큰). 게스트가 직접 신청한(requestedVia=GUEST) REQUESTED 주문만 취소 가능.
//   운영자 확정(CONFIRMED) 이후·타예약 주문·타경로 주문은 차단(404/409). 결제 없음.
//   동시성: where에 status="REQUESTED" 포함 + updateMany count=0이면 409(이미 확정/취소).
//   ★발주 가드(ADR-0023): 운영자가 원천공급자에게 PO를 보낸(vendorStatus=PENDING_VENDOR·
//     VENDOR_ACCEPTED) 주문은 게스트 셀프 취소 금지 — 공급자 취소 통보가 운영자 조율 필요라
//     stale PO를 막으려면 운영자만 취소. 미발주(null)·거절(VENDOR_REJECTED)만 셀프 취소 허용.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { guestTokenState } from "@/lib/guest-checkin";
import { guestRateLimit } from "@/lib/guest-rate-limit";
import { assertSameOrigin } from "@/lib/csrf";

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
  const order = await prisma.serviceOrder.findFirst({
    where: { id, bookingId: t.bookingId, requestedVia: "GUEST" },
    select: { id: true, status: true, vendorStatus: true, poSentAt: true },
  });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });

  // ★발주 가드 — 원천공급자에게 PO가 나간(살아있는) 주문은 게스트 셀프 취소 불가.
  //   공급자 취소 통보는 운영자 조율 필요(현재 자동 발송 없음). null·VENDOR_REJECTED만 허용.
  const dispatched =
    order.vendorStatus === "PENDING_VENDOR" || order.vendorStatus === "VENDOR_ACCEPTED";
  if (dispatched) {
    return NextResponse.json({ error: "DISPATCHED" }, { status: 409 });
  }

  // 동시성 가드 — status가 그 사이 CONFIRMED/CANCELLED로 바뀌거나 발주되면 count=0 → 409.
  //   where에 발주 안 된 조건(vendorStatus null 또는 VENDOR_REJECTED) 포함해 원자적으로 차단.
  const res = await prisma.serviceOrder.updateMany({
    where: {
      id,
      bookingId: t.bookingId,
      requestedVia: "GUEST",
      status: "REQUESTED",
      OR: [{ vendorStatus: null }, { vendorStatus: "VENDOR_REJECTED" }],
    },
    data: { status: "CANCELLED" },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "NOT_CANCELLABLE" }, { status: 409 });
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
    },
  });

  return NextResponse.json({ id, status: "CANCELLED" }, { status: 200 });
}
