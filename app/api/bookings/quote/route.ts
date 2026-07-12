import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { serializeBigInt } from "@/lib/serialize";
import { canViewFinance } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { MissingRateError } from "@/lib/pricing";
import { buildBookingQuote, BookingQuoteRejectedError } from "@/lib/booking-quote";

/**
 * GET /api/bookings/quote — 예약 생성 폼용 견적 (admin-manual-booking 후속 확장 2).
 *
 * 선택한 빌라 + 날짜 + 통화(+채널)의 요율 구간별 판매가·원가·마진·환율을 반환해 폼이
 * 판매가 입력칸을 자동으로 채우게 한다. 계산은 lib/booking-quote(=quoteStayForVilla,
 * 제안·관리자 예약 생성과 동일 엔진)에 위임 — 드리프트 0.
 *
 * ⚠️ 원가·마진 포함 응답 → isOperator보다 강한 canViewFinance 게이트(사업원칙 2 마진 비공개).
 */

const dateOnly = z.string().transform((s, ctx) => {
  const d = parseUtcDateOnly(s); // UTC 자정 정규화 (@db.Date 관례)
  if (!d) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `잘못된 날짜: ${s}` });
    return z.NEVER;
  }
  return d;
});

const querySchema = z
  .object({
    villaId: z.string().min(1),
    checkIn: dateOnly,
    checkOut: dateOnly,
    saleCurrency: z.enum(["KRW", "VND", "USD"]),
    channel: z.enum(["DIRECT", "TRAVEL_AGENCY", "LAND_AGENCY"]).optional(),
  })
  .refine((v) => v.checkIn.getTime() < v.checkOut.getTime(), {
    message: "체크인은 체크아웃보다 빨라야 합니다",
    path: ["checkOut"],
  });

export async function GET(req: Request) {
  // 첫 줄 게이트 — 원가·마진 포함이라 canViewFinance(OWNER·MANAGER·ADMIN)만
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;

  const sp = new URL(req.url).searchParams;
  const parsed = querySchema.safeParse({
    villaId: sp.get("villaId") ?? undefined,
    checkIn: sp.get("checkIn") ?? undefined,
    checkOut: sp.get("checkOut") ?? undefined,
    saleCurrency: sp.get("saleCurrency") ?? undefined,
    channel: sp.get("channel") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;

  try {
    const quote = await buildBookingQuote(
      prisma,
      d.villaId,
      { checkIn: d.checkIn, checkOut: d.checkOut },
      d.saleCurrency,
      d.channel
    );
    return Response.json({ quote: serializeBigInt(quote) });
  } catch (e) {
    if (e instanceof BookingQuoteRejectedError) {
      return Response.json({ error: e.reason }, { status: 404 });
    }
    // MissingBaseRateError(=MissingRateError) — 요율 미설정. admin-booking과 동일 코드.
    if (e instanceof MissingRateError) {
      return Response.json({ error: "RATE_NOT_SET", message: e.message }, { status: 409 });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[bookings/quote/GET] 견적 생성 실패", e);
    return Response.json({ error: "견적 생성에 실패했습니다" }, { status: 500 });
  }
}
