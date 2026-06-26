// POST /api/supplier/bookings/[id]/confirm — 공급자 직접판매 가예약 입금 확정 (F10 Phase B, ADR-0021 §7)
//
// 공급자가 자기 직접판매(seller=SUPPLIER) HOLD 예약을 자기 입금 확인 후 CONFIRMED로 전환한다.
// 비즈니스 로직은 운영자와 동일한 lib/hold.confirmHold 재사용 — 파트너 미연결이라 여신·채권은 no-op.
// 권한·누수: SUPPLIER + seller=SUPPLIER + villa.supplierId === 본인. 미일치=404(존재 비노출, T10.2 패턴).
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { confirmHold, HoldRejectedError } from "@/lib/hold";
import {
  SupplierBookingForbiddenError,
  assertSupplierCanInspectBooking,
} from "@/lib/supplier-booking-access";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 첫 줄 권한 검사 — SUPPLIER 전용 (비로그인 401 / 타롤 403)
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPPLIER") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const supplierId = session.user.id;

  const { id } = await params;
  try {
    // 소유·주체 가드 — 자기 빌라 AND seller=SUPPLIER 가 아니면 404(존재 비노출)
    const scope = await assertSupplierCanInspectBooking(prisma, id, supplierId);
    if (scope.status !== "HOLD") {
      return Response.json({ error: "INVALID_STATUS" }, { status: 409 });
    }

    await confirmHold(prisma, { bookingId: id, actorUserId: supplierId, now: new Date() });
    return Response.json({ status: "CONFIRMED" });
  } catch (e) {
    if (e instanceof SupplierBookingForbiddenError) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (e instanceof HoldRejectedError) {
      // HOLD_EXPIRED·INVALID_STATUS·PARTNER_CREDIT_BLOCKED 등 — 상태 경합/만료는 409
      const status = e.reason === "PROPOSAL_ITEM_NOT_FOUND" ? 404 : 409;
      return Response.json({ error: e.reason, message: e.message }, { status });
    }
    console.error("[supplier/confirm] 실패:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "입금 확정에 실패했습니다" }, { status: 500 });
  }
}
