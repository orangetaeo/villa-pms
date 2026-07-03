// PATCH /api/booking-change-requests/[id] — 파트너 요청 처리 (T-partner-workflow-gaps ②, 운영자 전용)
//
// action=approve | reject (+resolutionNote, HOLD_EXTEND는 extendHours 1~72).
//   - CANCEL 승인: 실제 취소(cancelBooking — 재고 복귀·공급자 알림 포함)까지 수행.
//   - MODIFY 승인: 상태 표시만 — 실제 변경은 운영자가 예약변경 패널에서 수행(구조화 안 된 자유 텍스트 요청).
//   - HOLD_EXTEND 승인: holdExpiresAt 연장(HOLD 유지 시에만 — 만료 전이 후엔 409).
// 처리 결과는 파트너에게 인앱+Zalo 통지(커밋 후, 실패 무해).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { cancelBooking, HoldRejectedError } from "@/lib/hold";
import {
  ChangeRequestError,
  resolveChangeRequest,
} from "@/lib/booking-change-request";
import { notifyPartner } from "@/lib/partner-notify";

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  resolutionNote: z.string().max(1000).optional(),
  extendHours: z.number().int().min(1).max(72).optional(),
});

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID_STATUS: 409,
  DUPLICATE: 409,
  ALREADY_RESOLVED: 409,
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  try {
    // CANCEL 승인은 실제 취소를 "먼저" 수행 — 취소 실패(상태 전이 등) 시 요청은 PENDING 유지되어
    // 운영자가 사유 확인 후 거절/재시도할 수 있다(요청만 APPROVED로 남는 반쪽 상태 방지).
    if (parsed.data.action === "approve") {
      const reqRow = await prisma.bookingChangeRequest.findUnique({
        where: { id },
        select: { kind: true, status: true, bookingId: true, note: true },
      });
      if (!reqRow) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      if (reqRow.status !== "PENDING") {
        return NextResponse.json({ error: "ALREADY_RESOLVED" }, { status: 409 });
      }
      if (reqRow.kind === "CANCEL") {
        const reason = `파트너 취소 요청 승인${reqRow.note ? ` — ${reqRow.note}` : ""}`;
        await cancelBooking(prisma, {
          bookingId: reqRow.bookingId,
          cancelReason: reason,
          actorUserId: session.user.id,
          // 자기 요청은 자동 종결에서 제외 — 아래 resolveChangeRequest가 APPROVED로 처리
          excludePendingRequestId: id,
        });
      }
    }

    const resolved = await resolveChangeRequest(prisma, {
      requestId: id,
      actorUserId: session.user.id,
      action: parsed.data.action === "approve" ? "APPROVE" : "REJECT",
      resolutionNote: parsed.data.resolutionNote ?? null,
      extendHours: parsed.data.extendHours,
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE",
      entity: "BookingChangeRequest",
      entityId: resolved.id,
      changes: {
        status: { old: "PENDING", new: resolved.status },
        resolutionNote: { new: resolved.resolutionNote },
        ...(resolved.newHoldExpiresAt
          ? { holdExpiresAt: { new: resolved.newHoldExpiresAt.toISOString() } }
          : {}),
      },
    });

    // 파트너에게 처리 결과 통지 (인앱+Zalo) — 커밋 후, 실패 무해(내부 격리).
    await notifyPartner(resolved.partnerId, {
      kind: "CHANGE_REQUEST_RESOLVED",
      bookingId: resolved.bookingId,
      villaName: resolved.villaName,
      requestKind: resolved.kind,
      approved: resolved.status === "APPROVED",
      resolutionNote: resolved.resolutionNote,
    });

    return NextResponse.json({
      ok: true,
      request: {
        id: resolved.id,
        kind: resolved.kind,
        status: resolved.status,
        newHoldExpiresAt: resolved.newHoldExpiresAt,
      },
    });
  } catch (e) {
    if (e instanceof ChangeRequestError) {
      return NextResponse.json(
        { error: e.reason },
        { status: ERROR_STATUS[e.reason] ?? 409 }
      );
    }
    if (e instanceof HoldRejectedError) {
      // CANCEL 승인 중 취소 불가(이미 취소·체크인 등) — 요청은 PENDING 유지
      return NextResponse.json(
        { error: "CANCEL_FAILED", reason: e.reason, message: e.message },
        { status: 409 }
      );
    }
    console.error("[booking-change-requests] 처리 실패", e);
    return NextResponse.json({ error: "처리에 실패했습니다" }, { status: 500 });
  }
}
