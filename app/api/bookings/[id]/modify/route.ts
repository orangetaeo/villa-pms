import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  modifyBooking,
  BookingModifyRejectedError,
  type BookingModifyRejectReason,
} from "@/lib/booking-modify";
import { serializeBigInt } from "@/lib/serialize";
import { isOperator, canViewFinance } from "@/lib/permissions";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { requireCapability } from "@/lib/api-guard";

/**
 * PATCH /api/bookings/[id]/modify — 예약 변경 (운영자 전용, F-booking-modify).
 *
 * - isOperator 게이트(STAFF 포함 변경 가능). saleCurrency·channel은 입력에 없음(범위 밖·잠금).
 * - 금액은 서버 재계산(클라 신뢰 금지). 응답의 판매가는 canViewFinance(OWNER/MANAGER)만 노출,
 *   STAFF는 totalSaleKrw/Vnd·fxVndPerKrw를 제거(원가 supplierCostVnd는 STAFF도 가시 — 기존 정책 동일).
 * - 에러코드 → HTTP: 입력검증 400 / 상태·동시성·채권·매진 409 / 그 외 500.
 */

// YYYY-MM-DD 문자열 — UTC 자정 Date로 변환(실존하지 않는 날짜 거부)
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다")
  .refine((s) => parseUtcDateOnly(s) !== null, "실존하는 날짜여야 합니다");

const modifySchema = z
  .object({
    checkIn: dateOnly.optional(),
    checkOut: dateOnly.optional(),
    villaId: z.string().min(1).optional(),
    guestName: z.string().trim().min(1).optional(),
    guestCount: z.number().int().min(1).optional(),
    guestPhone: z.string().trim().nullable().optional(),
    breakfastIncluded: z.boolean().optional(),
    reason: z.string().trim().optional(),
  })
  .strict() // saleCurrency·channel 등 미허용 키는 거부(범위 밖)
  .refine(
    (d) =>
      d.checkIn !== undefined ||
      d.checkOut !== undefined ||
      d.villaId !== undefined ||
      d.guestName !== undefined ||
      d.guestCount !== undefined ||
      d.guestPhone !== undefined ||
      d.breakfastIncluded !== undefined,
    "변경할 필드가 최소 하나는 필요합니다"
  );

/** 거부 사유 → HTTP 상태 */
const STATUS_BY_REASON: Record<BookingModifyRejectReason, number> = {
  BOOKING_NOT_FOUND: 404,
  STATUS_NOT_MODIFIABLE: 409,
  CHECKED_IN_FIELD_LOCKED: 409,
  NO_CHANGES: 400,
  INVALID_RANGE: 400,
  INVALID_GUEST_COUNT: 400,
  SOLD_OUT: 409,
  OVER_CAPACITY: 409,
  RECEIVABLE_EXISTS: 409,
  CONCURRENT_MODIFICATION: 409,
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const body = await req.json().catch(() => null);
  const parsed = modifySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const { id } = await params;
  try {
    const result = await modifyBooking(prisma, {
      bookingId: id,
      actorUserId: session.user.id,
      now: new Date(),
      checkIn: d.checkIn ? parseUtcDateOnly(d.checkIn)! : undefined,
      checkOut: d.checkOut ? parseUtcDateOnly(d.checkOut)! : undefined,
      villaId: d.villaId,
      guestName: d.guestName,
      guestCount: d.guestCount,
      guestPhone: d.guestPhone,
      breakfastIncluded: d.breakfastIncluded,
      reason: d.reason,
    });

    // 재무 게이트(원칙2): STAFF는 판매가·환율 제거. 원가(supplierCostVnd)는 기존 정책상 STAFF도 가시.
    const showFinance = canViewFinance(session.user.role);
    const b = serializeBigInt(result.booking) as Record<string, unknown>;
    if (!showFinance) {
      delete b.totalSaleKrw;
      delete b.totalSaleVnd;
      delete b.fxVndPerKrw;
    }

    return Response.json({
      booking: b,
      changedFields: result.changedFields,
      recalculated: result.recalculated,
      // 과수납 경고(T-D) — 판매가 관련 정보라 canViewFinance 일 때만 노출
      ...(showFinance ? { overpayment: result.overpayment } : {}),
    });
  } catch (e) {
    if (e instanceof BookingModifyRejectedError) {
      return Response.json(
        { error: e.reason, message: e.message },
        { status: STATUS_BY_REASON[e.reason] ?? 409 }
      );
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[bookings/modify] 실패", e);
    return Response.json({ error: "변경 처리에 실패했습니다" }, { status: 500 });
  }
}
