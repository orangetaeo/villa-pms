// /api/partner/bookings/[id]/change-request — 파트너 취소·변경·홀드연장 요청 (T-partner-workflow-gaps ②)
//
// POST: requireAuth + Role=PARTNER + APPROVED + 본인 partnerId 예약만(IDOR 404).
//   요청은 큐 적재만 — 예약 상태·금액은 절대 변경하지 않는다(운영자 승인형).
//   예약당 미해결(PENDING) 요청 1건 제한(409 DUPLICATE). 커밋 후 운영자 Zalo 통지.
//   ★ 누수: 응답에 KRW·원가·마진 없음(요청 메타만).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { getPartnerForUser } from "@/lib/partner-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { assertSameOrigin } from "@/lib/csrf";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  CHANGE_REQUEST_KINDS,
  ChangeRequestError,
  createChangeRequest,
  notifyOperatorsOfChangeRequest,
} from "@/lib/booking-change-request";

const REQUEST_LIMIT = { max: 20, windowMs: 10 * 60_000 };

const bodySchema = z.object({
  kind: z.enum(CHANGE_REQUEST_KINDS),
  note: z.string().max(1000, "요청 내용은 1000자 이하여야 합니다").optional(),
});

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID_STATUS: 409,
  DUPLICATE: 409,
  ALREADY_RESOLVED: 409,
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  if (g.session.user.role !== "PARTNER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const csrf = await assertSameOrigin(req, "partner-change-request");
  if (csrf) return csrf;

  const ip = clientIp(req.headers);
  const userOk = checkRateLimit(
    `partner-change-request:user:${g.session.user.id}`,
    REQUEST_LIMIT
  ).allowed;
  const ipOk = ip
    ? checkRateLimit(`partner-change-request:ip:${ip}`, REQUEST_LIMIT).allowed
    : true;
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

  try {
    const created = await createChangeRequest(prisma, {
      partnerId: partner.id,
      bookingId: id,
      kind: parsed.data.kind,
      note: parsed.data.note ?? null,
    });

    await writeAuditLog({
      userId: g.session.user.id,
      action: "PARTNER_CHANGE_REQUEST",
      entity: "BookingChangeRequest",
      entityId: created.id,
      changes: {
        bookingId: { new: id },
        kind: { new: created.kind },
        note: { new: parsed.data.note ?? null },
      },
    });

    // 커밋 후 운영자 Zalo 통지 — 실패해도 요청 생성 결과에 무영향(내부 격리).
    await notifyOperatorsOfChangeRequest({
      partnerName: partner.name,
      kind: created.kind,
      villaName: created.villaName,
      checkIn: created.checkIn,
      checkOut: created.checkOut,
      note: parsed.data.note ?? null,
      bookingId: id,
    });

    return NextResponse.json({
      ok: true,
      request: {
        id: created.id,
        kind: created.kind,
        status: created.status,
        createdAt: created.createdAt,
      },
    });
  } catch (e) {
    if (e instanceof ChangeRequestError) {
      return NextResponse.json(
        { error: e.reason },
        { status: ERROR_STATUS[e.reason] ?? 409 }
      );
    }
    console.error("[partner/change-request] 생성 실패", e);
    return NextResponse.json({ error: "처리에 실패했습니다" }, { status: 500 });
  }
}
