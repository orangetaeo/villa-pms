// DELETE /api/supplier/bookings/[id] — SUPPLIER 직접예약 취소 (T10.2, F10 / ADR-0021 §6)
//
// 공급자는 seller=SUPPLIER AND 자기 빌라(supplierId) 예약만 취소 가능.
// 운영자 예약(seller=OPERATOR)·타 공급자 예약은 존재 여부도 비노출(404).
import { NextResponse } from "next/server";
import { BookingSeller, BookingStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

/** 공급자 직접예약 취소 기본 사유 (cancelReason NOT NULL 대비 — 공급자 수동 취소) */
const DEFAULT_CANCEL_REASON = "공급자 직접예약 취소";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 첫 줄 권한 검사 — SUPPLIER 전용 (비로그인 401 / 타롤 403 분리)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const supplierId = session.user.id;

  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      seller: true,
      status: true,
      villa: { select: { supplierId: true } },
    },
  });

  // 소유·주체 가드: 자기 빌라 AND seller=SUPPLIER 가 아니면 존재 비노출(404).
  // 운영자 예약·타 공급자 예약을 공급자가 취소·식별하지 못하게 한다 (재고·마진 비공개).
  if (
    !booking ||
    booking.villa.supplierId !== supplierId ||
    booking.seller !== BookingSeller.SUPPLIER
  ) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // CONFIRMED 만 취소 대상 (직접예약은 생성 즉시 CONFIRMED). 이미 다른 상태면 거부.
  if (booking.status !== BookingStatus.CONFIRMED) {
    return NextResponse.json({ error: "INVALID_STATUS" }, { status: 409 });
  }

  // status 가드 — 동시 변경 경합 시 한쪽만 승리
  const guarded = await prisma.booking.updateMany({
    where: { id: booking.id, status: BookingStatus.CONFIRMED, seller: BookingSeller.SUPPLIER },
    data: { status: BookingStatus.CANCELLED, cancelReason: DEFAULT_CANCEL_REASON },
  });
  if (guarded.count !== 1) {
    return NextResponse.json({ error: "INVALID_STATUS" }, { status: 409 });
  }

  await writeAuditLog({
    userId: supplierId,
    action: "UPDATE",
    entity: "Booking",
    entityId: booking.id,
    changes: {
      status: { old: BookingStatus.CONFIRMED, new: BookingStatus.CANCELLED },
      cancelReason: { new: DEFAULT_CANCEL_REASON },
      action: { new: "SUPPLIER_DIRECT_BOOKING_CANCEL" },
    },
  });

  return NextResponse.json({ ok: true });
}
