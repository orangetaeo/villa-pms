// /api/partner/bookings/[id]/roster — 파트너 본인 예약의 투숙객 명단 사전 제출 (여행사 포털 E)
//
// PATCH: requireAuth + Role=PARTNER + 본인 partnerId 예약만(IDOR). HOLD/CONFIRMED만 편집.
//   공개 /api/p/[token]/roster의 로그인 미러 — guestRoster 단일 컬럼만 수정(상태·금액 불변).
//   ★ 누수: select·응답에 KRW·원가·마진 없음(id·status·partnerId 교차검증만).
import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingStatus } from "@prisma/client";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { getPartnerForUser } from "@/lib/partner-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { assertSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const ROSTER_LIMIT = { max: 30, windowMs: 10 * 60_000 };

const bodySchema = z.object({
  guestRoster: z.string().max(2000, "명단은 2000자 이하여야 합니다"),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  if (g.session.user.role !== "PARTNER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const csrf = await assertSameOrigin(req, "partner-roster");
  if (csrf) return csrf;

  const ip = clientIp(req.headers);
  const userOk = checkRateLimit(`partner-roster:user:${g.session.user.id}`, ROSTER_LIMIT).allowed;
  const ipOk = ip ? checkRateLimit(`partner-roster:ip:${ip}`, ROSTER_LIMIT).allowed : true;
  if (!userOk || !ipOk) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const partner = await getPartnerForUser(g.session.user.id);
  if (!partner || partner.approvalStatus !== "APPROVED") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  // ★ IDOR 차단: id + partnerId 동시 일치만. 타 파트너 예약은 NOT_FOUND.
  const booking = await prisma.booking.findFirst({
    where: { id, partnerId: partner.id },
    select: { id: true, status: true, guestRoster: true },
  });
  if (!booking) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // 체크인 이후·취소·만료 예약은 입력 불가 (명단은 체크인 전 준비용)
  if (booking.status !== BookingStatus.HOLD && booking.status !== BookingStatus.CONFIRMED) {
    return NextResponse.json({ error: "CLOSED" }, { status: 409 });
  }

  const roster = parsed.data.guestRoster.trim() === "" ? null : parsed.data.guestRoster;
  await prisma.booking.update({
    where: { id: booking.id },
    data: { guestRoster: roster },
    select: { id: true },
  });
  await writeAuditLog({
    userId: g.session.user.id,
    action: "UPDATE",
    entity: "Booking",
    entityId: booking.id,
    changes: { guestRoster: { old: booking.guestRoster, new: roster } },
  });

  return NextResponse.json({ ok: true, guestRoster: roster });
}
