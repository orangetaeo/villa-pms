import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createLinkedExtensionBooking,
  CreateExtensionRejectedError,
  type CreateExtensionRejectReason,
} from "@/lib/booking-extend";
import { serializeBigInt } from "@/lib/serialize";
import { isOperator, canViewFinance } from "@/lib/permissions";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { requireCapability } from "@/lib/api-guard";

/**
 * POST /api/bookings/[id]/extend — 분할 숙박: 다른 빌라로 연장(연결 추가 예약) (ADR-0030 T-E).
 *
 * - isOperator 게이트. [id]=부모(연장할 원) 예약. body.villaId=대체 빌라(부모와 달라야 함).
 * - 새 자식 예약을 생성하고 parentBookingId로 연결. 판매가는 canViewFinance(OWNER/MANAGER)만.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => parseUtcDateOnly(s) !== null, "실존하는 날짜여야 합니다");

const extendSchema = z
  .object({
    villaId: z.string().min(1),
    checkIn: dateOnly,
    checkOut: dateOnly,
  })
  .strict();

const STATUS_BY_REASON: Record<CreateExtensionRejectReason, number> = {
  PARENT_NOT_FOUND: 404,
  PARENT_NOT_EXTENDABLE: 409,
  INVALID_RANGE: 400,
  SAME_VILLA: 400,
  SOLD_OUT: 409,
  OVER_CAPACITY: 409,
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const body = await req.json().catch(() => null);
  const parsed = extendSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const { id } = await params;
  try {
    const result = await createLinkedExtensionBooking(prisma, {
      parentBookingId: id,
      villaId: d.villaId,
      checkIn: parseUtcDateOnly(d.checkIn)!,
      checkOut: parseUtcDateOnly(d.checkOut)!,
      actorUserId: g.session.user.id,
      now: new Date(),
    });

    // 재무 게이트(원칙2): STAFF는 판매가·환율 제거. 원가(supplierCostVnd)는 기존 정책상 가시.
    const b = serializeBigInt(result.booking) as Record<string, unknown>;
    if (!canViewFinance(g.session.user.role)) {
      delete b.totalSaleKrw;
      delete b.totalSaleVnd;
      delete b.fxVndPerKrw;
      delete b.fxVndPerUsd;
    }
    return Response.json({ booking: b }, { status: 201 });
  } catch (e) {
    if (e instanceof CreateExtensionRejectedError) {
      return Response.json(
        { error: e.reason, message: e.message },
        { status: STATUS_BY_REASON[e.reason] ?? 409 }
      );
    }
    console.error("[bookings/extend] 실패", e);
    return Response.json({ error: "연장 예약 생성에 실패했습니다" }, { status: 500 });
  }
}
