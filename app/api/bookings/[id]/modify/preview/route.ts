import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { previewBookingModify } from "@/lib/booking-modify-preview";
import { serializeBigInt } from "@/lib/serialize";
import { isOperator, canViewFinance } from "@/lib/permissions";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { requireCapability } from "@/lib/api-guard";

/**
 * POST /api/bookings/[id]/modify/preview — 예약 변경 미리보기(dry-run, ADR-0030 T-B).
 *
 * - isOperator 게이트. **쓰기 없음** — modifyBooking과 동일 코어로 결과만 계산.
 * - 재무 게이트(원칙2): 판매가·추가청구·수납·과수납은 canViewFinance(OWNER/MANAGER)만.
 *   STAFF는 정원·공실·차단사유(blockers)·nights만 본다.
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다")
  .refine((s) => parseUtcDateOnly(s) !== null, "실존하는 날짜여야 합니다");

const previewSchema = z
  .object({
    checkIn: dateOnly.optional(),
    checkOut: dateOnly.optional(),
    villaId: z.string().min(1).optional(),
    guestCount: z.number().int().min(1).optional(),
  })
  .strict();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const body = await req.json().catch(() => null);
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const { id } = await params;
  let preview;
  try {
    preview = await previewBookingModify(prisma, {
      bookingId: id,
      checkIn: d.checkIn ? parseUtcDateOnly(d.checkIn)! : undefined,
      checkOut: d.checkOut ? parseUtcDateOnly(d.checkOut)! : undefined,
      villaId: d.villaId,
      guestCount: d.guestCount,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "BOOKING_NOT_FOUND") {
      return Response.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
    }
    console.error("[bookings/modify/preview] 실패", e);
    return Response.json({ error: "미리보기 계산에 실패했습니다" }, { status: 500 });
  }

  // 재무 게이트 — STAFF는 판매가·추가청구·수납·과수납 제거
  const p = serializeBigInt(preview) as Record<string, unknown>;
  if (!canViewFinance(g.session.user.role)) {
    for (const k of [
      "existingSaleKrw",
      "existingSaleVnd",
      "newSaleKrw",
      "newSaleVnd",
      "additionalKrw",
      "additionalVnd",
      "collectedVnd",
      "newTotalVnd",
      "overpayment",
    ]) {
      delete p[k];
    }
  }

  return Response.json({ preview: p });
}
