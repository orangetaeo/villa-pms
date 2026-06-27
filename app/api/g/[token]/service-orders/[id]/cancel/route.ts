// POST /api/g/[token]/service-orders/[id]/cancel — 게스트 셀프 취소(A3)
//   비로그인(토큰). 게스트가 직접 신청한(requestedVia=GUEST) REQUESTED 주문만 취소 가능.
//   운영자 확정(CONFIRMED) 이후·타예약 주문·타경로 주문은 차단(404/409). 결제 없음.
//   동시성: where에 status="REQUESTED" 포함 + updateMany count=0이면 409(이미 확정/취소).
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
    select: { id: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });

  // 동시성 가드 — status가 그 사이 CONFIRMED/CANCELLED로 바뀌면 count=0 → 409.
  const res = await prisma.serviceOrder.updateMany({
    where: { id, bookingId: t.bookingId, requestedVia: "GUEST", status: "REQUESTED" },
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
