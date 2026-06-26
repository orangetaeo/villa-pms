// /api/bookings/[id]/guest-token — 게스트 셀프 체크인 토큰 발급/재발급·회수 (ADR-0019 S3, 운영자)
//   POST: 발급/재발급(이전 토큰 대체, 만료=체크아웃+1일). DELETE: 회수.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator, type Role } from "@/lib/permissions";
import { generateGuestToken, defaultGuestTokenExpiry } from "@/lib/guest-checkin";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role as Role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, checkOut: true },
  });
  if (!booking) return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });

  const token = generateGuestToken();
  const expiresAt = defaultGuestTokenExpiry(booking.checkOut);

  // 재발급 시 새 토큰·만료로 갱신하고 회수상태 해제(서명 증빙은 보존)
  await prisma.guestCheckinToken.upsert({
    where: { bookingId: id },
    create: { bookingId: id, token, expiresAt },
    update: { token, expiresAt, revokedAt: null },
  });

  await writeAuditLog({
    db: prisma,
    userId: session.user.id,
    action: "UPDATE",
    entity: "Booking",
    entityId: id,
    changes: { guestCheckinToken: { new: "issued" } },
  });

  return NextResponse.json({ token, url: `/g/${token}`, expiresAt });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role as Role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.guestCheckinToken.findUnique({ where: { bookingId: id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.guestCheckinToken.update({
    where: { bookingId: id },
    data: { revokedAt: new Date() },
  });
  await writeAuditLog({
    db: prisma,
    userId: session.user.id,
    action: "UPDATE",
    entity: "Booking",
    entityId: id,
    changes: { guestCheckinToken: { new: "revoked" } },
  });
  return NextResponse.json({ id, revoked: true });
}
