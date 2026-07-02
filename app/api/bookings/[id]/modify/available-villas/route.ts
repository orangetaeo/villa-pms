import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findSellableVillaIds, type StayRange } from "@/lib/availability";
import { isOperator } from "@/lib/permissions";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { requireCapability } from "@/lib/api-guard";

/**
 * POST /api/bookings/[id]/modify/available-villas — 예약 변경용 가용 빌라 셀렉터 (ADR-0030 UX).
 *
 * 주어진 기간·인원에 **판매 가능(공실+정원+검수통과)** 한 빌라만 반환한다. 자기 예약은 점유에서
 * 제외(현재 빌라도 후보 유지). 현재 빌라는 상태 무관하게 항상 목록에 포함(선택 유지·표시용).
 * isOperator 전용(재고 비공개 — ADMIN 화면에서만). 판매가·마진은 반환하지 않음(이름만).
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => parseUtcDateOnly(s) !== null, "실존하는 날짜여야 합니다");

const bodySchema = z
  .object({
    checkIn: dateOnly,
    checkOut: dateOnly,
    guestCount: z.number().int().min(1),
  })
  .strict();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const { id } = await params;

  const range: StayRange = {
    checkIn: parseUtcDateOnly(parsed.data.checkIn)!,
    checkOut: parseUtcDateOnly(parsed.data.checkOut)!,
  };
  if (!(range.checkIn.getTime() < range.checkOut.getTime())) {
    return Response.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { villaId: true, villa: { select: { id: true, name: true } } },
  });
  if (!booking) return Response.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });

  // 자기 예약 제외 가용 빌라 id (공실+정원+검수통과)
  const availableIds = await findSellableVillaIds(
    prisma,
    range,
    undefined,
    parsed.data.guestCount,
    id
  );

  // 이름 조회 + 현재 빌라 항상 포함(가용 목록에 없어도 선택 유지용, 맨 앞)
  const villas = await prisma.villa.findMany({
    where: { id: { in: availableIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const options = villas.filter((v) => v.id !== booking.villaId);
  options.unshift({ id: booking.villa.id, name: booking.villa.name });

  return Response.json({ villas: options });
}
