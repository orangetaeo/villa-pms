import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { previewBookingModify } from "@/lib/booking-modify-preview";
import { canViewFinance } from "@/lib/permissions";
import { parseUtcDateOnly, toDateOnlyString } from "@/lib/date-vn";
import { requireCapability } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit-log";
import { sendBotMessage } from "@/lib/zalo-runtime";
import { fmtVnd } from "@/lib/settlement-statement";

/**
 * POST /api/bookings/[id]/modify/notice-zalo — 예약 변경(숙박 연장 등) 비용안내를 여행사(파트너)
 * Zalo로 직접 발송. 소비자 안내는 클라이언트 "복사"(카톡용) 버튼이 담당하고, 이 라우트는
 * **여행사 대상 Zalo 전송**만 처리한다.
 *
 * - canViewFinance 게이트 — 판매가·추가청구(파트너 청구액)를 담으므로 재무 권한 필수.
 * - 파트너는 User가 아니라 Partner.contactZaloUid를 직접 보유(청구서 발송과 동일 경로).
 * - 금액은 클라이언트 값을 신뢰하지 않고 **서버에서 previewBookingModify로 재계산**한다(변조 방지).
 * - VND 객실료 기준(파트너 채권과 정합). 마진·KRW 판매가는 미노출(원칙2).
 */

export const runtime = "nodejs";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다")
  .refine((s) => parseUtcDateOnly(s) !== null, "실존하는 날짜여야 합니다");

const bodySchema = z
  .object({
    checkIn: dateOnly.optional(),
    checkOut: dateOnly.optional(),
    villaId: z.string().min(1).optional(),
    guestCount: z.number().int().min(1).optional(),
  })
  .strict();

const dot = (d: Date) => toDateOnlyString(d).replaceAll("-", ".");

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      checkIn: true,
      checkOut: true,
      guestName: true,
      villa: { select: { name: true } },
      partner: { select: { id: true, name: true, contactZaloUid: true } },
    },
  });
  if (!booking) {
    return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
  }
  if (!booking.partner) {
    return NextResponse.json({ error: "NO_PARTNER" }, { status: 422 });
  }
  const zaloUid = booking.partner.contactZaloUid?.trim();
  if (!zaloUid) {
    return NextResponse.json({ error: "NO_ZALO_LINK" }, { status: 422 });
  }

  // 서버 재계산 — 클라이언트 금액 미신뢰
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
      return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
    }
    console.error("[bookings/modify/notice-zalo] 미리보기 실패", e);
    return NextResponse.json({ error: "PREVIEW_FAILED" }, { status: 500 });
  }

  const newCheckIn = d.checkIn ? parseUtcDateOnly(d.checkIn)! : booking.checkIn;
  const newCheckOut = d.checkOut ? parseUtcDateOnly(d.checkOut)! : booking.checkOut;

  // 파트너 대상 본문(vi) — VND 객실료만(마진·KRW 미노출)
  const lines = [
    "🏡 Villa Go — Thông báo thay đổi đặt phòng",
    `Villa: ${booking.villa.name}`,
    `Khách: ${booking.guestName}`,
    `Thời gian: ${dot(booking.checkIn)}~${dot(booking.checkOut)} → ${dot(newCheckIn)}~${dot(newCheckOut)}`,
    `Số đêm: ${preview.nightsOld} → ${preview.nightsNew}`,
  ];
  if (preview.additionalVnd != null) {
    const add = preview.additionalVnd;
    const sign = add > 0n ? "+" : "";
    lines.push(`Phụ thu: ${sign}${fmtVnd(add)}`);
  }
  if (preview.newSaleVnd != null) {
    lines.push(`Tổng mới: ${fmtVnd(preview.newSaleVnd)}`);
  }
  lines.push("Cảm ơn quý đối tác!");
  const text = lines.join("\n");

  const result = await sendBotMessage(zaloUid, text);
  if (!result.ok) {
    return NextResponse.json(
      { error: "SEND_FAILED", detail: result.error },
      { status: 502 }
    );
  }

  await writeAuditLog({
    userId: g.session.user.id,
    action: "UPDATE",
    entity: "Booking",
    entityId: id,
    changes: {
      modifyNoticeZaloSent: { new: booking.partner.id },
      nights: { new: `${preview.nightsOld}→${preview.nightsNew}` },
    },
  });

  return NextResponse.json({ ok: true });
}
