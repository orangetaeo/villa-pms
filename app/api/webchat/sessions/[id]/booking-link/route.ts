// POST/DELETE /api/webchat/sessions/[id]/booking-link — 웹챗 세션 ↔ 예약 연결/해제 (T-webchat-guest-link-share)
//
// 운영자 전체(OWNER/MANAGER/STAFF/ADMIN) 개방 — 웹챗은 구조적 무금액이라 STAFF 안전(reply와 동일 게이트).
// 웹챗 세션은 조직 공유 자산(ownerAdminId는 알림용만) — 한 운영자가 연결하면 전 운영자에게 보인다.
//   ★응답 예약 요약에 금액 필드(판매가·원가·마진·정산) 절대 미포함(누수 게이트).
//   ★연결/해제 전건 writeAuditLog(오연결 추적).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability, notFoundIfMissing } from "@/lib/api-guard";

const postSchema = z.object({ bookingId: z.string().min(1) });

// 예약 요약 select — ★금액 필드 없음(guestName·기간·상태·빌라명만).
const BOOKING_SUMMARY_SELECT = {
  id: true,
  guestName: true,
  checkIn: true,
  checkOut: true,
  status: true,
  villa: { select: { name: true } },
} as const;

type BookingSummaryRow = {
  id: string;
  guestName: string;
  checkIn: Date;
  checkOut: Date;
  status: string;
  villa: { name: string } | null;
};

/** 예약 요약 직렬화(FE 배지용) — 금액 무관 표시 전용. */
function serializeBookingSummary(b: BookingSummaryRow) {
  return {
    bookingId: b.id,
    guestName: b.guestName,
    villaName: b.villa?.name ?? null,
    checkIn: b.checkIn.toISOString(),
    checkOut: b.checkOut.toISOString(),
    status: b.status,
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // 첫 줄 role 검사 — 운영자 전체.
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }
  const { bookingId } = parsed.data;

  // 세션 존재 확인(조직 공유 — ownerAdminId 스코프 없음).
  const session = await prisma.webChatSession.findFirst({
    where: { id },
    select: { id: true, bookingId: true },
  });
  const foundSession = notFoundIfMissing(session);
  if (!foundSession.ok) return foundSession.response;
  const s = foundSession.resource;

  // 예약 존재 확인(금액 미조회).
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: BOOKING_SUMMARY_SELECT,
  });
  if (!booking) return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });

  // 이미 다른 예약에 연결돼 있어도 덮어쓰기 허용(재연결).
  const now = new Date();
  await prisma.webChatSession.update({
    where: { id: s.id },
    data: { bookingId, bookingLinkedAt: now, bookingLinkedBy: g.userId },
  });

  await writeAuditLog({
    userId: g.userId,
    action: "UPDATE",
    entity: "WebChatSession",
    entityId: s.id,
    changes: {
      bookingId: { old: s.bookingId ?? null, new: bookingId },
      bookingLink: { new: "linked" },
    },
  });

  return NextResponse.json({ ok: true, booking: serializeBookingSummary(booking) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  const session = await prisma.webChatSession.findFirst({
    where: { id },
    select: { id: true, bookingId: true },
  });
  const foundSession = notFoundIfMissing(session);
  if (!foundSession.ok) return foundSession.response;
  const s = foundSession.resource;

  // 이미 미연결이면 무해(멱등) — 3필드 null 리셋.
  await prisma.webChatSession.update({
    where: { id: s.id },
    data: { bookingId: null, bookingLinkedAt: null, bookingLinkedBy: null },
  });

  await writeAuditLog({
    userId: g.userId,
    action: "UPDATE",
    entity: "WebChatSession",
    entityId: s.id,
    changes: {
      bookingId: { old: s.bookingId ?? null, new: null },
      bookingLink: { new: "unlinked" },
    },
  });

  return NextResponse.json({ ok: true, sessionId: s.id });
}
