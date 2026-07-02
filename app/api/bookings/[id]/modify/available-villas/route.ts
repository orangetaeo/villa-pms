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
    // modify=이 예약 변경(자기 점유 제외·현재 빌라 항상 포함) / extend=다른 빌라로 연장(현재 빌라 제외)
    purpose: z.enum(["modify", "extend"]).default("modify"),
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

  const forExtend = parsed.data.purpose === "extend";

  // 가용 빌라 id (공실+정원+검수통과). modify는 자기 예약을 점유에서 제외(현재 빌라 후보 유지),
  // extend는 연장 구간의 신규 예약이라 제외 불필요(자기 예약은 그 구간을 점유하지 않음).
  const availableIds = await findSellableVillaIds(
    prisma,
    range,
    undefined,
    parsed.data.guestCount,
    forExtend ? undefined : id
  );

  const villas = await prisma.villa.findMany({
    where: { id: { in: availableIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (forExtend) {
    // 연장: 현재(원) 빌라는 SAME_VILLA로 불가하므로 후보에서 제외. 강제 포함 없음.
    return Response.json({ villas: villas.filter((v) => v.id !== booking.villaId) });
  }

  // 변경: 현재 빌라 항상 포함(가용 목록에 없어도 선택 유지용, 맨 앞)
  const options = villas.filter((v) => v.id !== booking.villaId);
  options.unshift({ id: booking.villa.id, name: booking.villa.name });
  return Response.json({ villas: options });
}
