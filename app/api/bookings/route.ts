import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { serializeBigInt } from "@/lib/serialize";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { createAdminBooking, AdminBookingRejectedError } from "@/lib/admin-booking";

/**
 * POST /api/bookings — 관리자 수동 예약 생성 (admin-manual-booking).
 * 운영자(테오)가 전화·Zalo로 직접 받은 예약을 대시보드에서 바로 기록. ADMIN 전용.
 * 재고 비공개·마진 비공개·검수 게이트 원칙은 createAdminBooking이 강제한다.
 */

const dateOnly = z.string().transform((s, ctx) => {
  const d = parseUtcDateOnly(s); // UTC 자정 정규화 (@db.Date 관례)
  if (!d) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `잘못된 날짜: ${s}` });
    return z.NEVER;
  }
  return d;
});

const createSchema = z
  .object({
    villaId: z.string().min(1),
    checkIn: dateOnly,
    checkOut: dateOnly,
    guestName: z.string().trim().min(1, "고객명은 필수입니다"),
    guestCount: z.number().int().positive(),
    guestPhone: z.string().trim().max(40).optional(),
    channel: z.enum(["DIRECT", "TRAVEL_AGENCY", "LAND_AGENCY"]),
    partnerId: z.string().min(1).optional(),
    agencyName: z.string().trim().max(200).optional(),
    saleCurrency: z.enum(["KRW", "VND", "USD"]),
    // 숫자 문자열 — VND BigInt 안전. 서버에서 통화별 파싱(KRW/USD→Int, VND→BigInt).
    totalSale: z.string().trim().regex(/^\d+$/, "판매 총액은 0 이상의 정수 문자열이어야 합니다"),
    breakfastIncluded: z.boolean().optional(),
    status: z.enum(["HOLD", "CONFIRMED"]),
    holdExpiresAt: z.string().datetime().optional(),
  })
  .refine((v) => v.checkIn.getTime() < v.checkOut.getTime(), {
    message: "체크인은 체크아웃보다 빨라야 합니다",
    path: ["checkOut"],
  })
  .refine((v) => v.status !== "HOLD" || !!v.holdExpiresAt, {
    message: "가예약(HOLD)은 만료시각(holdExpiresAt)이 필수입니다",
    path: ["holdExpiresAt"],
  });

export async function POST(req: Request) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;

  // 통화별 총액 파싱 — KRW/USD는 Int, VND는 BigInt (float 금지)
  let totalSaleKrw: number | null = null;
  let totalSaleVnd: bigint | null = null;
  let totalSaleUsd: number | null = null;
  if (d.saleCurrency === "VND") {
    totalSaleVnd = BigInt(d.totalSale);
  } else {
    const n = Number(d.totalSale);
    if (!Number.isSafeInteger(n)) {
      return Response.json(
        { error: "invalid_input", message: "판매 총액이 정수 범위를 벗어났습니다" },
        { status: 400 }
      );
    }
    if (d.saleCurrency === "KRW") totalSaleKrw = n;
    else totalSaleUsd = n;
  }

  try {
    const booking = await createAdminBooking(prisma, {
      villaId: d.villaId,
      range: { checkIn: d.checkIn, checkOut: d.checkOut },
      guestName: d.guestName,
      guestCount: d.guestCount,
      guestPhone: d.guestPhone ?? null,
      channel: d.channel,
      partnerId: d.partnerId ?? null,
      agencyName: d.agencyName ?? null,
      saleCurrency: d.saleCurrency,
      totalSaleKrw,
      totalSaleVnd,
      totalSaleUsd,
      breakfastIncluded: d.breakfastIncluded,
      status: d.status,
      holdExpiresAt: d.holdExpiresAt ? new Date(d.holdExpiresAt) : null,
      actorUserId: session.user.id,
      now: new Date(),
    });
    return Response.json({ booking: { id: booking.id } }, { status: 201 });
  } catch (e) {
    if (e instanceof AdminBookingRejectedError) {
      // VILLA_NOT_FOUND=404, 그 외 상태·재고·여신 거부=409
      const status = e.reason === "VILLA_NOT_FOUND" ? 404 : 409;
      return Response.json({ error: e.reason, message: e.message }, { status });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[bookings/POST] 수동 예약 생성 실패", e);
    return Response.json({ error: "예약 생성에 실패했습니다" }, { status: 500 });
  }
}
